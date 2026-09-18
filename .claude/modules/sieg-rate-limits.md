# Sieg API — rate limits

## `/v1/baixar-xmls` (download de XMLs — CT-e, e futuramente outros tipos)

Limite documentado pela Sieg pra essa rota especificamente: **2 requisições por minuto, até 50 XMLs por requisição**. É por rota — não é o mesmo limite genérico do resto da API Sieg.

Implementado em `src/modules/handlers/fiscal/integrations/sieg/services/documents/ctes/cte.service.ts`:
- `SIEG_BAIXAR_XMLS_MAX_PAGE_SIZE = 50` e `SIEG_BAIXAR_XMLS_MIN_INTERVAL_MS = 30_000` são hard limits (constantes, não vêm de env) — o contrato real da Sieg, nunca deve ultrapassar mesmo com env mal configurada.
- `SIEG_XML_PAGE_SIZE` (env `SIEG_XML_PAGE_SIZE`, default 50) é clampado com `Math.min(..., SIEG_BAIXAR_XMLS_MAX_PAGE_SIZE)` — controla o tamanho de página na paginação automática (`wantsAllPages`).
- `SIEG_MIN_INTERVAL_MS` (env `SIEG_MIN_INTERVAL_MS`, default 35_000) é clampado com `Math.max(..., SIEG_BAIXAR_XMLS_MIN_INTERVAL_MS)` — intervalo mínimo entre chamadas a essa rota, via `throttleSiegRequest` (fila serializada em memória do processo, `siegNextAvailableAt`/`siegThrottleChain`).
- `fetchXmlPage` também clampa `Take` na hora de montar a request (`boundedParams`), cobrindo o caso de um `take` explícito vir de fora maior que 50 (hoje nenhum chamador passa `take`, mas o clamp cobre se isso mudar).

Esse throttle é o único ponto que chama `/v1/baixar-xmls` no código (confirmado — nenhum outro arquivo referencia essa rota), então não tem risco de outro caminho furar o limite por fora dele.

## Limite genérico (todas as rotas Sieg)

`sieg_api.service.ts` tem um limitador separado e mais frouxo (`SIEG_RATE_LIMIT_INTERVAL_MS`, default 500ms, via slot reservado em Redis — `waitForSiegRateLimit`), aplicado a toda chamada à API Sieg independente da rota. Esse valor **não tem confirmação oficial da doc da Sieg** (era um chute inicial) — só o limite de `/v1/baixar-xmls` acima foi confirmado pelo usuário.

## Retry de 429

Também em `sieg_api.service.ts`: até `SIEG_429_MAX_RETRIES` tentativas (default 5), respeita `Retry-After`, senão backoff exponencial `SIEG_429_BASE_DELAY_MS` → `SIEG_429_MAX_DELAY_MS` (default 3s → 60s). Independente do throttle acima — cobre o caso de mesmo respeitando o intervalo mínimo, a Sieg ainda responder 429 (ex.: limite mais apertado do que o documentado, ou uso concorrente por outro processo).
