# Tecinco API auth/session

`src/modules/handlers/tecinco/api/tecinco_api.ts`

- `sessionPool` (a `Map<branchId, TCarBranchSession>`) caches one session token per branch, in memory only — lost on every process restart. Both `ensureSession` (cache-miss login) and `onResponseError`'s 401 handler (session-expired relogin) call `doTCarLogin(branchId)`, and each already serializes concurrent calls *for the same branch* via the branch's own `isRefreshing`/`failedQueue`.
- **Fixed — intermittent 403 on `/auth/login`**: `doTCarLogin` uses the *same* account credentials (username/password/api_key/company_id) for every branch — only the later `/auth/session/branch` call differs by branch. The per-branch lock above doesn't stop two *different* branches from calling `/auth/login` at the same time (e.g. `TCarSyncQueue` dispatches one `invoices`/`invoice-updates` job per branch — currently branches `12`/`17` — both can run concurrently right after a process restart or whenever both branches' cached tokens are empty at once). Tecinco's API rejects one of two concurrent logins for the same account with a bare 403 (not 401/429, so neither existing retry path in the response interceptor catches it) — matched the observed pattern of ~3% of requests failing with a plain "Request failed with status code 403" bottoming out in `doTCarLogin`. **Fixed** by wrapping `doTCarLogin`'s entire body in a **module-level** (not per-branch) promise-chain mutex (`withTCarLoginLock`), so logins for different branches queue up instead of racing — covers both call sites (`ensureSession`, the 401 relogin path) since both go through `doTCarLogin`.
- **`TCAR_UPSERT`/`TCAR_SYNC` deliberately do NOT share a BullMQ
  `sharedLock`** (unlike Bling's queues, which share
  `BLING_SHARED_QUEUE_LOCK` — see `.claude/modules/ml-order-pipeline/locks.md`
  and `bling-queue-lock.ts`). This was considered and rejected:
  `TCarSyncQueue.process` (`tecinco-sync-queue.ts`) calls `runProductsMigration`
  (`tecinco-migration.runner.ts`), which enqueues jobs onto `TCAR_UPSERT`
  (the full-migration script's `runMigration` still blocks on
  `waitForQueueToDrain(upsertQueue, ...)` as part of the *same* run). A full job-level `sharedLock` between the two queues
  would deadlock: the sync job holds the lock while waiting for
  `TCAR_UPSERT` to drain, but `TCAR_UPSERT` jobs can never acquire that
  same lock to run and drain. The module-level login mutex above already
  serializes the actual race (concurrent `/auth/login` calls) without this
  risk, since both queues funnel through the same `doTCarLogin`. If queue-level
  coordination between `TCAR_UPSERT`/`TCAR_SYNC` is wanted later, it needs
  a narrower lock scoped to the individual Tecinco API calls inside
  `migrateProdutos`/`migrateClientes`/`migrateNotasFiscais`, not the whole
  job — the `waitForQueueToDrain` step must stay outside any such lock.
- **Fixed — cancelled invoice never re-synced**: there is no Tecinco webhook
  push for invoices; the only sync mechanism is `migrateNotasFiscais`
  (`src/scripts/tecinco/tecinco-migration.runner.ts`), polled every 5min by
  `TCarSyncQueue` (`invoice-updates` kind, no drain wait). It lists notas via `GET /notas-fiscais` filtered by
  `situacao`. It queried only `situacao: "A"` (ativa), so once an
  already-imported invoice got cancelled in Tecinco (`situacao` flips to
  `"C"`) it dropped out of that list entirely and was never re-enqueued —
  `isCancelledInvoice`/`isInvoiceCancellationStatus` in
  `src/shared/utils/xml/invoice-xml.ts` (which does correctly read
  `cabecalho.situacao`/`fiscal.situacao_nfe === "C"` and set the invoice to
  `PENDING_CANCELLED_SYSTEM`) simply never received fresh data for that
  invoice again. **Fixed** by also querying `situacao: "C"` per
  branch/tipo in `migrateNotasFiscais`, so cancelled notas get re-enqueued
  through the same `invoice_xml`/`sync` job (same jobId format — safe to
  reuse since completed BullMQ jobs are removed via `removeOnComplete:
  true`) and picked up by the existing cancellation-detection logic.
- **`situacao: "N"` also queried** (confirmed with the user: a normal nota,
  same handling as `"A"` — not a rejection/error status) alongside `"A"`/`"C"`
  in `migrateNotasFiscais`'s `SITUACOES` array. No special-casing needed
  beyond adding it to the fetch list — `isInvoiceCancellationStatus` is
  unaffected since `"N"` was never in its cancellation-status list.
- **Perf — parallelized independent Tecinco calls that were needlessly
  sequential**: none of these touch the login mutex, the per-branch session
  cache, or the "no shared lock between `TCAR_UPSERT`/`TCAR_SYNC`" rule
  above — they only parallelize calls that don't depend on each other and
  reuse the same already-cached branch session token.
  - `TCarUpsertQueue` (`tecinco-api-fetch.queue.ts`) `concurrency` raised
    from `1` to `3`. This raises concurrent DB load though:
    `src/config/sequelize.ts` has a single Sequelize instance shared by the
    **entire app** (147+ files, not just Tecinco), and had no explicit
    `pool` config (Sequelize default `max: 5`). Raised to `pool: { max: 10,
    min: 0, acquire: 60000, idle: 10000 }` (only `max` changed from
    Sequelize's own defaults) alongside the concurrency bump so
    `TCAR_UPSERT` jobs (each doing several sequential DB reads/writes per
    item) don't starve unrelated queues/HTTP requests of connections.
  - **Fixed — 429s in production from this parallelization**: raising
    `concurrency` + the `Promise.all` changes below caused real Tecinco
    429s once deployed — the previous per-request 429 exponential-backoff
    retry in `tcar_api.ts` only *reacts* to hitting the limit, it doesn't
    *prevent* bursts. **Fixed** by adding a proper global rate limiter,
    mirroring `waitForBlingRateLimit` in
    `bling_api.service.ts`/`.claude/modules/ml-order-pipeline/rate-limit.md`
    exactly: `waitForTecincoRateLimit()` in `tecinco_api.ts`, a Redis-backed
    check-and-claim Lua script (`TCAR_TRY_DISPATCH_SCRIPT`) storing only the
    last real dispatch timestamp (not a reserved future slot — avoids the
    same burst-under-event-loop-contention bug documented for Bling),
    default `TCAR_RATE_LIMIT_INTERVAL_MS=334` (3 req/s), called at the top
    of the `tcarApi` `onRequest` interceptor. Since `tcarRequest(branchId,
    ...)` builds its scoped axios instance by directly reusing `tcarApi`'s
    `interceptors.request`/`interceptors.response` objects (not copying
    them), this one limiter call covers every Tecinco call in the app,
    including concurrent ones from `Promise.all` — each has to win the same
    atomic Redis check to fire, so throughput self-serializes to the
    configured rate process-wide regardless of `concurrency` or how many
    calls fire at once. Env var added to all 4 `docker-compose.yml` service
    blocks that already had `TCAR_429_MAX_DELAY` (and to local `.env`).
  - `TCarUpsertQueue.processInvoiceXml`: `upsertCustomerFromTCar` and
    `ensureProductsFromInvoiceItems` now run via `Promise.all` instead of
    one awaiting the other — both only read from the same already-fetched
    `notaFiscal` detail, neither depends on the other's result.
  - **Fixed — invoice imported with empty `items`/`unmappedProducts` despite
    the nota having real items on Tecinco**: `processInvoiceXml` wraps
    detail-fetch + customer upsert + item resolution in one `try`; any
    throw (including from `upsertCustomerFromTCar`, unrelated to items) set
    `detailFetchFailed=true` and both arrays stayed empty. In
    `upsertInvoiceFromXml` (invoice-xml.ts), when the caller provides
    neither `operationalItems` nor `unmappedItems`, it deliberately skips
    the invoice's items entirely for that pass (no raw-XML fallback despite
    a stale comment implying one) rather than guess from XML `det`. Fixed by
    catching `upsertCustomerFromTCar` failures locally (logged, not
    rethrown) so a customer-upsert error can no longer blank out the items.
    A note stuck like this heals on the next sync pass once fixed (update
    path calls `addMissingInvoiceItems`).
  - `TCarUpsertQueue.ensureProductsFromInvoiceItems`: the per-item
    `produtoService.obterProduto` calls (previously one Tecinco API round
    trip per invoice line item, sequential — an N+1) are now pre-fetched
    together via `Promise.all` into a `Map<systemId, payload>` before the
    existing per-item resolution/upsert loop runs (that loop itself stays
    sequential, since it does DB writes per item).
  - `migrateNotasFiscais` (`tecinco-migration.runner.ts`): the
    `listarNotasFiscais` calls per branch (2 tipos × 3 situacoes = 6 — see
    the cancellation-resync and `situacao: "N"` notes above) now run via
    `Promise.all` instead of nested sequential loops; enqueueing the
    resulting notas stays sequential per branch (local BullMQ `add`, not a
    Tecinco call, so no benefit to parallelizing it).
- **New `TCarUpsertQueue` resource: `invoice_transfer`** — background
  enrichment of a PDV transfer-invoice linked instantly via a provisional
  `Invoice` row (see `.claude/entities/pdv-sales-request/index.md`'s "Nota de
  transferência" section and `.claude/entities/invoice/index.md`'s
  "Provisional/stub invoices"). `attachTransferInvoice` enqueues `{ resource:
  "invoice_transfer", data: { numero, chaveAcesso, pdvSalesRequestId } }`
  instead of calling `upsertInvoiceFromTecinco` synchronously (that method,
  and `upsertInvoiceFromXml`, still exist and still run synchronously for
  their *other* callers — see their own doc comments, "roda síncrono, fora da
  fila, pra propagar erro de verdade pro chamador" — this is a genuinely new,
  separate call path, not a change to those methods). The worker
  (`processInvoiceTransfer`) just calls the same `upsertInvoiceFromTecinco`
  method — same login mutex/rate-limiter/session-cache rules as every other
  Tecinco call in this file apply unchanged — then always calls
  `notifySalesRequestUpdated(pdvSalesRequestId)` in a `finally`, success or
  failure, so the front refetches either way; a thrown error still propagates
  after that so BullMQ retries the job normally.

- **`TCarSyncQueue` dispatch (`tecinco-sync-queue.ts`)**: 3 kinds, each skipped if a same-kind sync job is pending. `invoices` (60s, `invoice-new`, always dispatches); `products` (5min, ONE job for all branches — payload `branchIds`; single `include=filiais` fetch; products only — customers are upserted per invoice by `processInvoiceXml`/`upsertCustomerFromTCar`, not synced periodically; no drain wait, dispatches only if `TCAR_API_FETCH` is empty; ignores `TCAR_INVOICE` entirely); `invoice-updates` (5min, `migrateNotasFiscais` without waiting for drain, dispatches only if no `invoice-update` job is pending in `TCAR_INVOICE`). Previously the 5/10min sync required `TCAR_INVOICE` fully empty, so a failing `invoice-new` retried every minute starved it.
  No sync job waits for a queue to drain and `TCAR_INVOICE` has no update-vs-new redelay: `invoice-new` (priority 1) and `invoice-update` (priority 2) just share `TCAR_INVOICE`'s slots by priority. `TCAR_API_FETCH` runs concurrency 5 / limiter 5 jobs per second (products only); `TCAR_INVOICE` runs 2 / 2.
- **Lookup cache (`tecinco/queues/helpers/lookup-cache.ts`)**: `TCarUpsertQueue` jobs read the Tecinco integration, `UnitBusiness` by branch number and `integrations_id` per unit business from an in-process cache (TTL 5min, null/not-found never cached) instead of querying per job. `resolveIntegrationsIdForUnitBusiness` bypasses it when called inside a `transaction`. Tests must call `clearTCarLookupCache()` in `beforeEach`.
