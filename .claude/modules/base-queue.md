# BaseQueueService — comportamento comum a toda fila

`src/shared/utils/base-models/base-queue-service.ts`. Locks (`withSharedLock`/`withOrderLock`) em `ml-order-pipeline/locks.md`.

## Contexto do job (`job-context.ts`)

Todo `process(job)` roda dentro de `jobContext.run(createJobContext(lane, enqueuedAt))` (AsyncLocalStorage, propaga por todo await). `lane` = `rateLimitLane(job)` (default `queueName`), `enqueuedAt` = `job.timestamp`. Consumido por `waitForBlingRateLimit` (faixas — ver `ml-order-pipeline/rate-limit.md`). Também carrega `rateLimitWait` (ver abaixo). Stall não tem relação com espera longa: enquanto o job está em `await`, o BullMQ renova o lock sozinho.

## `maxProcessingMs` desconta espera de rate limit

`runProcessWithTimeout` mede só tempo **ativo**: `Date.now() - início - rateLimitWaitMs(context)`. O timer re-arma com o que falta em vez de disparar fixo. Espera de rate limit = tudo dentro de `trackRateLimitWait(fn)` (`job-context.ts`): hoje `waitForBlingRateLimit` inteiro e o sleep de retry de 429 do interceptor `blingApi`. Esperas paralelas do mesmo job contam por tempo de parede (contador `inFlight`), não somadas. Motivo: com faixas, job ativo pode esperar vários ciclos de revezamento — timeout é pra job travado (HTTP/deadlock), não pra fila da Bling.

## Cancelamento no timeout (`abortController` do contexto)

`Promise.race` sozinho não para o `process(job)` — o job original seguiria rodando junto do retry. Cada execução tem um `AbortController` no `jobContext`; no timeout, `runProcessWithTimeout` faz `abort(timeoutError)` antes de rejeitar. O job original para com `JobAbortedError` no próximo **ponto de parada**:
- `waitForBlingSlot` (antes de cada tentativa de vaga + sleep do loop) e sleep de retry 429 do interceptor `blingApi` — via `throwIfJobAborted`/`sleepUnlessJobAborted`;
- loop de espera do `withOrderLock`; e, se o job abortado já segura o lock e trava dentro do `fn()`, a renovação para — lock expira no TTL (2min) em vez de ficar preso.
- **Requisição HTTP já em andamento não é cortada** (sem `config.signal`): POST de geração de NF-e cortado depois da Bling criar a nota faria o retry emitir duplicada. Termina pelo timeout próprio (`BLING_REQUEST_TIMEOUT_MS`).
- Não cobre: chamadas a outras APIs (ML, Tecinco), queries Sequelize, sleeps próprios das filas — o job para no próximo ponto de parada da Bling. Pra cobrir um ponto novo: `throwIfJobAborted()`/`sleepUnlessJobAborted()` de `job-context.ts`.
- `JobAbortedError` passa pelos `catch` genéricos das filas como qualquer erro (pode gerar log/integration_error do job abortado).

## Stall → reagendamento

Stall = lock do job no BullMQ expirou sem renovação (processo morreu/reiniciou com job ativo: deploy, autoheal, OOM). Após `maxStalledCount` (3) stalls o BullMQ falha o job com `"job stalled more than allowable limit"` — nessa versão (5.80) a falha vem como deferred failure processada pelo próprio worker, então chega no `worker.on("failed")` do processo que pegou o job (sem duplicata entre processos).

- `worker.on("failed")` com essa mensagem → `rescheduleStalledJob`: remove o job failed e re-adiciona com mesmo `jobId`/`name`/`data`/opts, `delay` 30s (`timestamp`/`repeat`/`delay` originais descartados — timestamp antigo faria o delay vencer na hora). `onFailed` **não** é chamado (job não falhou de verdade).
- Contador Redis `queue:stalled-reschedules:<fila>:<jobId>` (TTL 24h): passou de 5 → alerta HIGH + `onFailed` normal, job fica em failed (evita loop com job que derruba o processo).
- Sem graceful shutdown nos workers (`worker.close()` em SIGTERM não existe) — todo restart deixa os jobs ativos em stall.
- Workers não tinham `/health` até `health-server.ts`; com `autoheal` (`AUTOHEAL_CONTAINER_LABEL=all`) os containers de worker eram reiniciados em loop → fonte principal de stall até então.
