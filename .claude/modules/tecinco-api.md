# Tecinco API auth/session

- **Trava de escrita por ambiente**: `TECINCO_WRITES_ENABLED = NODE_ENV === "production"` em `conferencias-estoque.service.ts` — `validarItem`/`conferir`/`autoConferir` (únicos POSTs de dado; disparados por `finishBatch` → `postTecincoConferencia` em lote de expedição Tecinco) lançam fora de produção. Login/logout/seleção de filial (POST de sessão) e GETs seguem liberados.
`src/modules/handlers/tecinco/api/tecinco_api.ts`

- `sessionPool` (a `Map<branchId, TCarBranchSession>`) caches one session token per branch, in memory only — lost on every process restart. Both `ensureSession` (cache-miss login) and `onResponseError`'s 401 handler (session-expired relogin) call `doTCarLogin(branchId)`, and each already serializes concurrent calls *for the same branch* via the branch's own `isRefreshing`/`failedQueue`.
- **Filial fora de `allowed_branches` (ex.: 24, emitente de transferência)**: o usuário da integração (`PAX`) não tem a filial na lista do login → `POST /auth/session/branch` dá 403 ("Filial não permitida…"). Mas a Tecinco aceita `GET` com `?branch_id=<filial>` numa sessão **sem filial ativa** (detalhe, `/xml`, produto — confirmado); com sessão ativa em outra filial dá 403 "branch_id não corresponde à filial ativa". `doTCarLogin` só chama o session/branch se a filial está em `allowed_branches` (ou se a lista vier vazia); senão guarda o token sem seleção (log warn) — seguro porque o `sessionPool` é por filial.
- **Fixed — intermittent 403 on `/auth/login`**: `doTCarLogin` uses the *same* account credentials (username/password/api_key/company_id) for every branch — only the later `/auth/session/branch` call differs by branch. The per-branch lock above doesn't stop two *different* branches from calling `/auth/login` at the same time (e.g. `TCarSyncQueue` dispatches one `invoices`/`invoice-updates` job per branch — currently branches `12`/`17`/`11` — both can run concurrently right after a process restart or whenever both branches' cached tokens are empty at once). Tecinco's API rejects one of two concurrent logins for the same account with a bare 403 (not 401/429, so neither existing retry path in the response interceptor catches it) — matched the observed pattern of ~3% of requests failing with a plain "Request failed with status code 403" bottoming out in `doTCarLogin`. **Fixed** by wrapping `doTCarLogin`'s entire body in a **module-level** (not per-branch) promise-chain mutex (`withTCarLoginLock`), so logins for different branches queue up instead of racing — covers both call sites (`ensureSession`, the 401 relogin path) since both go through `doTCarLogin`.
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
  `migrateProdutos`/`migrateClientes`/`migrateNotasCanceladas`, not the whole
  job — the `waitForQueueToDrain` step must stay outside any such lock.
- **Sync de notas = só criação + cancelamento** (sem webhook Tecinco pra nota; `/notas-fiscais` não tem `alterado_desde`). NF-e autorizada não muda depois de emitida, exceto cancelamento — produto mapeado depois já cria o item via `resolveFromCreatedProduct` (ver `.claude/entities/unmapped-invoice-product/index.md`), então não há re-sync geral de nota existente. `situacao: "N"` é nota normal (mesmo tratamento de `"A"`, confirmado com o usuário).
  - **Novas (`migrateNovasNotasFiscais`, kind `invoices`)**: por filial, 4 listagens em paralelo (E/S × A/N), cada uma **uma requisição só** com `limit: 300` (`INVOICE_LOOKBACK`, sem paginação). Enfileira `invoice-new` pras que não têm Invoice (`xml_key`).
  - **Canceladas (`migrateNotasCanceladas`, kind `invoice-updates` — nome mantido porque kind desconhecido cai no fluxo de produtos em `TCarSyncQueue.process`)**: por filial, 1 listagem `situacao: "C"` sem filtro de tipo (`limit: 300`). `invoiceService.findXmlKeysNotCancelledInUnitBusinesses(chaves, tecincoUnitBusinessForPopulate)` devolve as que ainda têm `unitBusinessAttributes.status != CANCELLED` em alguma unit business Tecinco (por `number`); só essas viram `invoice-update` (jobId `invoice-update-<branch>-<E|S>-<nota>`). Cancelada sem Invoice nenhuma vira `invoice-new` (mesmo jobId/prioridade/dedup de `migrateNovasNotasFiscais`, incl. pular failed sem XML) e nasce `CANCELLED` (`resolveInitialStatus`) — sem requisição extra, sai da mesma listagem "C". Payload montado por `buildInvoiceXmlPayload`. O job reaproveita `processInvoiceXml` → `isCancelledInvoice` lê `cabecalho.situacao`/`fiscal.situacao_nfe` e cancela (`CANCELLED` + fora do lote aberto, ver `.claude/entities/invoice/index.md`).
  - Os dois tipos de job usam `removeOnComplete: { age: INVOICE_JOB_RETENTION_SECONDS }` (2h) e o sync pula jobId pendente ou completado recente (`getPendingJobIds(true)`) — senão um job que completa sem criar/cancelar (nota sem pneu, XML 404) reentraria todo tick.
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

- **`TCarSyncQueue` dispatch (`tecinco-sync-queue.ts`)**: 3 kinds, each skipped if a same-kind sync job is pending. `invoices` (60s, `invoice-new`, always dispatches); `products` (5min, ONE job for all branches — payload `branchIds`; single `include=filiais` fetch; products only — customers are upserted per invoice by `processInvoiceXml`/`upsertCustomerFromTCar`, not synced periodically; no drain wait, dispatches only if `TCAR_API_FETCH` is empty; ignores `TCAR_INVOICE` entirely); `invoice-updates` (60s, canceladas via `enqueueInvoiceCancellations` → `migrateNotasCanceladas` without waiting for drain, dispatches only if no `invoice-update` job is pending in `TCAR_INVOICE`). Previously the 5/10min sync required `TCAR_INVOICE` fully empty, so a failing `invoice-new` retried every minute starved it.
- **Listagem de notas (`listarNotasRecentes` no runner)**: uma requisição por situação (`limit: 300`, `offset: 0`, sem `paginateTCar`), filtro de tipo opcional. `populate-from-tecinco-choose.ts` roda novas + canceladas na etapa de notas, com `TCarInvoiceQueue` explícita — sem ela o runner cai no fallback `upsertQueue` (`TCAR_API_FETCH`). `runMigration` (`populate-from-tecinco.ts`) roda `migrateNotasCanceladas` junto de produtos.
- **`invoice-new`**: sem `alterado_desde`; a única "segunda chance" de uma nota é continuar dentro dessa janela. Por isso nota nova sem XML ainda (404 ou corpo vazio → `processInvoiceXml` retorna `TCAR_INVOICE_XML_UNAVAILABLE`) **não completa**: `TCarInvoiceQueue.process` faz `retryJobLater` a cada `TCAR_INVOICE_XML_RETRY_DELAY_MS` (5min), contando em `job.data.xmlUnavailableAttempts` (redelay não conta como attempt do BullMQ); na `TCAR_INVOICE_XML_MAX_ATTEMPTS`ª (5) lança `UnrecoverableError` com prefixo `TCAR_INVOICE_XML_UNAVAILABLE_FAILURE` → fica `failed` no Redis (retido 7 dias pelo `removeOnFail`), sem alerta por email (`onFailed` filtra o prefixo). `migrateNovasNotasFiscais` pula esses jobIds (`getFailedJobIdsByReason`) — senão o `add()` da base apagaria o failed e reenfileiraria; outras falhas (ex.: 500) continuam sendo reenfileiradas no tick seguinte — antes ela completava, ficava bloqueada 2h pela retenção do completed e saía da janela, nunca mais entrando. Só `invoice-new`; `invoice-update` sem XML segue completando. Nota com qualquer item sem `epctb_codigo` ou fora dos grupos de pneu continua ignorada inteira (regra de negócio confirmada).
  No sync job waits for a queue to drain and `TCAR_INVOICE` has no update-vs-new redelay: `TCAR_INVOICE` priorities (`tecinco-invoice.queue.ts`): `1` (`MANUAL_IMPORT_PRIORITY`) = manual import `invoice_by_key` **and** PDV `invoice_transfer` (`pdv-sales-request.service.ts` passa explícito — o confirm da NF espera esse import; FIFO entre os dois), `TCAR_INVOICE_NEW_PRIORITY` (2) = `invoice-new`, `TCAR_INVOICE_UPDATE_PRIORITY` (3) = `invoice-update` and the queue default (`TCarInvoiceQueue.add` override, só pra quem não passa priority). They just share `TCAR_INVOICE`'s slots by priority. `TCAR_API_FETCH` runs concurrency 5 / limiter 5 jobs per second (products only); `TCAR_INVOICE` runs 2 / 2.
- **Lookup cache (`tecinco/queues/helpers/lookup-cache.ts`)**: `TCarUpsertQueue` jobs read the Tecinco integration, `UnitBusiness` by branch number and `integrations_id` per unit business from an in-process cache (TTL 5min, null/not-found never cached) instead of querying per job. `resolveIntegrationsIdForUnitBusiness` bypasses it when called inside a `transaction`. Tests must call `clearTCarLookupCache()` in `beforeEach`.
- **Entrada sem XML → XML da filial emitente (`processInvoiceXml`)**: o sync só lista as filiais de `tecincoUnitBusinessForPopulate`, então transferência vinda de loja fora dessa lista aparece só como **entrada** na loja destino — e entrada lançada sem importar XML dá 404 no `/xml` (`situacao_nfe` ≠ 100). No 404 de uma **entrada**, pega a chave do detalhe (`fiscal.chave_nfe`), CNPJ do emitente via `parseAccessKey` → `unitBusinessService.findOne({ cnpj })` → `number` = branch Tecinco, e busca `/notas-fiscais/:n/xml?chave_nfe=` lá (a saída autorizada). Emitente sem unit business (fornecedor), igual à própria filial, ou 404/erro também na emitente → segue `TCAR_INVOICE_XML_UNAVAILABLE` (retry do `invoice-new`). Saída não tenta (a filial já é a emitente). Precisa do usuário da integração com acesso à filial emitente na Tecinco. Import manual e PDV já resolvem a filial emitente antes de buscar (ver `.claude/modules/manual-import.md`, `.claude/entities/pdv-sales-request/index.md`).
- **XML de nota antiga = referência de arquivo, não XML**: `GET /notas-fiscais/:n/xml` devolve `{F17DBA68-…}=<id>` (texto, não XML/JSON) pra notas emitidas antes de ~2026-01/04 (arquivadas na Tecinco) — independe de `situacao`; notas recentes vêm como `nfeProc` normal. O detalhe JSON (`GET /notas-fiscais/:n`) dessas notas funciona. `buscarXmlNotaFiscal` detecta corpo que não começa com `<` e retorna `null` (log warn); `processInvoiceXml` ignora a nota (job completa, sem retry/alerta — `null` é tratado como permanente, diferente de 404/vazio), `upsertInvoiceFromTecinco` lança "XML da nota fiscal indisponível na Tecinco". Caso típico: cancelada antiga reenfileirada pelo sync de canceladas. O `onResponse` do `tcarApi` não tenta JSON.parse em request com `responseType: "text"`. Import manual pelo front (`upsertInvoiceFromXml(xmlContent, branchId)`) não usa esse endpoint — usa o XML enviado + detalhe JSON — então é o caminho pra trazer nota antiga.
- **Rotas `/api/tecinco/sync/products` e `/sync/customers`** (`service/tecinco/tecinco.routes.ts`): exigem `authenticate`.
- **`invoice_by_key` (`TCAR_INVOICE`)**: import manual de nota por chave de acesso (módulo manual-import, `.claude/modules/manual-import.md`). Payload `{ numero, chaveAcesso }` + `branchId` → `upsertInvoiceFromTecinco`. `upsertInvoiceFromXml`/`upsertInvoiceFromTecinco` retornam `IMPORT_JOB_RESULT` (`shared/utils/queues/job-status.ts`): `IGNORED_NO_TIRE_ITEMS` quando a nota não tem item de pneu (nem resolvido nem pendente), senão `IMPORTED` — vira o `returnvalue` do job (`TCarUpsertQueue` é `BaseQueueService<TCarUpsertJobPayload, ImportJobResult | void>`).
- **`listarProdutos` aceita `codigo_integracao`** (= `epctb_codigo`, o `external_id` em `integration_mappings`) — busca de produto por id no import manual.
- **Limites da API (doc oficial TCarWebServer)**: `alterado_desde` (`DTAALT >=`, inclusivo) só filtra `/clientes`, `/veiculos`, `/produtos`, `/servicos/:attma_id`, `/estados`, `/cidades`, `/modelos-veiculos`, `/cores-veiculos`, `/combustiveis-veiculos`, `/condicoes-pagamento`, `/ordens-servico` — **`/notas-fiscais` não aceita**, então o sync de notas não tem filtro incremental. `limit` aceita 1–500 por página (default 50; `paginateTCar` usa 50 fixo). Toda listagem retorna `pagination.total`.
- **`GET /notas-fiscais` (doc oficial)**: filtros opcionais `entrada_saida`, `situacao` (A/N/C), `modelo_documento`, `data_movimento_inicio/fim`, `data_emissao_inicio/fim`, `nota`, `serie`, `cliente_id`, `produto_codigo` etc.; ordenação `EPENF_DTAINS DESC`. Item da listagem traz `chave` (composta), `entrada_saida`, `funcao`, `situacao`, `cliente`, `emissao`, `movimento`, `valor_nota`, `chave_nfe` — sem data de alteração. `GET /notas-fiscais/:nota` e `/xml` aceitam identificação por `chave_nfe` **ou** pela chave composta; 409 se a identificação for ambígua.
