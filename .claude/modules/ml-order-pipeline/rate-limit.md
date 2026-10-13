# Bling API rate limit — ML order pipeline

É por CONTA, não por app/OAuth client. Confirmado em developer.bling.com.br/limites: 3 req/s, 120k/dia, compartilhado pela conta inteira. `waitForBlingRateLimit()` (`bling/api/bling_api.service.ts`) é o limiter leaky-bucket único backed por Redis (Lua `EVAL` atômico), chamado tanto pelo interceptor `onRequest` da instância axios `blingApi` quanto pelos dois scrapers Playwright/cookie-session que bypassam essa instância inteiramente (`get-stock-movements.ts`, `nfe-manifest-web-scraping.service.ts`).

**Revisitado**: usuário reportou 429s "estourando toda hora" apesar do interval já bem abaixo do limite no papel. Dois gaps reais:
- `handleBlingOAuthCallback`'s token-exchange `fetch()` não tinha timeout nenhum — adicionado o mesmo timeout de 30s que `doRefreshToken` já tinha.
- Toda chamada de escrita à Bling (POST/PUT/PATCH) em vários queues chamava `blingApi.get/post/put/patch` direto, sem o buffer extra de pacing `BLING_ORDER_REQUEST_DELAY_MS` que só o helper `blingGet` aplicava. `get-with-sleep.ts` agora exporta `blingGet`/`blingPost`/`blingPut`/`blingPatch` — todos os quatro aplicam o mesmo pacing + timeout explícito por chamada (`BLING_REQUEST_TIMEOUT_MS`, default 20s; geração de NFe override pra 45s).
- `BLING_RATE_LIMIT_INTERVAL_MS` default elevado 1500ms → 2000ms pra folga extra, a pedido explícito do usuário.

## Dispatch: check-and-claim atômico com faixas (`FAIR_DISPATCH_SCRIPT`)

Script: `resources/redis/bling-fair-dispatch.lua` (fora de `src/` — `tsc` não copia `.lua` pro `dist`; caminho via `REDIS_SCRIPTS_DIR` em `config/resource-paths.ts`), carregado por `bling_api.service.ts` como `FAIR_DISPATCH_SCRIPT`.

Vazão é fixa (1 chamada a cada `BLING_RATE_LIMIT_INTERVAL_MS`, **não baixar** — 2000ms já é o mínimo sem 429). O script só decide **quem** usa cada vaga, por chamada (nunca por job inteiro — lock por job deixa vaga ociosa durante DB/sleep e job longo trava tudo).

- **Check-and-claim**: o script só guarda o último dispatch real concedido; quem não ganha recebe quanto esperar e **reconfere** no Redis (sleep nunca é confiado — design antigo de "reservar slot futuro e disparar cego" gerava rajadas sob event loop ocupado).
- **Faixa** = `jobContext` (`shared/utils/base-models/job-context.ts`, AsyncLocalStorage setado pelo `BaseQueueService` em volta de todo `process(job)`). Default = nome da fila (`rateLimitLane(job)`, override pra dividir). Fora de job (API HTTP, script) = `NO_QUEUE`. Chega no limiter sem mudar call site — interceptor `onRequest` e scrapers chamam `waitForBlingRateLimit()`.
- **Escolha da vaga** (`bling/api/bling-rate-limit-lanes.ts`): faixas `BLING_STRICT_LANES` passam na frente de tudo, na ordem da lista — `MANUAL` (ação de usuário esperando na tela: `BlingOrderQueue` com `FORCE_UPDATE_PRIORITY` = force-update individual, `BlingApiFetchQueue` com `BLING_FETCH_CREATE_PRODUCT_PRIORITY` = create-from-unmapped; via override de `rateLimitLane` por `job.opts.priority`) e depois `NFE_EMISSION`; demais revezam em ordem alfabética, cada uma pegando até `weight` vagas seguidas (default 3, `BLING_LANE_WEIGHTS` sobrescreve); faixa sem ninguém esperando é pulada (nenhuma vaga ociosa). Dentro da faixa: menor `job.timestamp` primeiro → job mais antigo termina antes de o próximo começar.
- **Handoff**: vaga escolhida pra ticket que não é o chamador fica em `assigned` (hash `rate-limit:bling:lane-state`); só ele pega. Não buscou em `BLING_CLAIM_TIMEOUT_MS` (5s) → descartado (re-entra se vivo).
- **Tickets mortos**: cada chamada ao script é heartbeat (`rate-limit:bling:alive-tickets`); sem heartbeat há >`BLING_TICKET_STALE_MS` (15s) → removido da faixa. Por isso nenhuma espera do loop passa de `interval`.
- Chaves: `rate-limit:bling:last-dispatch-at`, `:lane-state`, `:active-lanes` (set), `:alive-tickets` (zset), `:lane:<faixa>` (zset ticket→job.timestamp), TTL 1h renovado a cada chamada.
- Faixa strict só fura a fila de **chamadas à Bling** — o job ainda precisa de slot de worker na própria fila (prioridade 1 do BullMQ põe na frente, mas não interrompe job ativo: na api-fetch, `concurrency: 1`, espera o job atual terminar).
- `BLING_API_FETCH` (fora o create-from-unmapped) é uma faixa só: `concurrency: 1`, então dividir por recurso não muda nada (prioridade BullMQ já põe nota antes de produto).

## Env: `BLING_RATE_LIMIT_INTERVAL_MS` — fixed, faltava em 6 de 6 serviços do `docker-compose.yml`

Confirmado e corrigido: `docker-compose.yml` propagava `BLING_ORDER_REQUEST_DELAY_MS` pra todo service block relevante mas nunca propagava `BLING_RATE_LIMIT_INTERVAL_MS` pra nenhum — todo container caía no default do código independente do que fosse setado no ambiente/`.env`, ignorando silenciosamente qualquer override do operador. **Fixed** adicionando `BLING_RATE_LIMIT_INTERVAL_MS: ${BLING_RATE_LIMIT_INTERVAL_MS}` junto da linha `BLING_ORDER_REQUEST_DELAY_MS` já existente nos 6 service blocks. Se uma nova env var de pacing Bling for adicionada depois: lembrar que `docker-compose.yml` precisa dela em cada service block individualmente — não há bloco de env compartilhado/herdado neste arquivo.
