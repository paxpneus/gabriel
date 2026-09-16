# ML → Bling NFe scheduling pipeline

`src/modules/handlers/mercado-livre/`, `.../bling-nfe/`

Referência viva completa (6 filas, precondição/escrita de cada uma, tabela de estados `OrderInternalStatus` ↔ situação Bling, lock por pedido, todo par de corrida já mapeado): `docs/automation/order-pipeline.md`. **Mantenha esse arquivo atualizado, não os daqui** — os arquivos abaixo são histórico de investigação/fix de sessão, não a referência viva.

Ver `../../entities/order/status-sync.md` pra `escalateToHumanVerificationIfStillPending`/`syncOrderInternalStatus` (decisão centralizada de status a cada fila) e `../../entities/order/index.md`/`summary-endpoints.md` pro fix de permissão `USER_TYPES` e o script `fix-by-different-situation.ts`.

Split por assunto:
- `bug-fixes.md` — 3 bugs reais no fluxo de sync ML, `reason_cancelled`, escrita antecipada de status, limiar do `reconcileStuckOrders`
- `collection-date.md` — origem do `collection_date`, redesign do `ML-SCRAPING`, bug de timezone UTC, `setDelayBasedOnDate`
- `summary-endpoints.md` — `GET /api/order/summary/...`, janela de embarque 06h–14h, escopo store-only
- `locks.md` — `BLING_SHARED_QUEUE_LOCK`, aging, lock por pedido
- `rate-limit.md` — `waitForBlingRateLimit`, race no dispatch, env do docker-compose
