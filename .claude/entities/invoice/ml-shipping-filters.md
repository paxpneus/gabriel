# Mercado Livre shipping-queue filters

`pending_mercadolivre`, `all_today_mercadolivre`, `finished_mercado_livre`, `dispatched_mercado_livre` — each a `=true` boolean flag, mutually exclusive tabs of one screen ("o que precisa/já foi embarcado hoje pelo Mercado Livre"). 4 entries in `InvoiceService.queryConfig.customFields` (`invoice.service.ts`) — **not** the repository. All four require `$store.name$ = "MercadoLivre"`.

## Design history — superseded twice

Current design: a fixed 06h–14h "shipping window" on the event timestamp itself, not a clock-based cutoff.
- Original (`storeCollectionDateTodayWhere`): matched `$order.collection_date$` within today's BRT calendar day — replaced because a note can ship today even with a future `collection_date` (early dispatch already emitted).
- Second (`shipTodayEligibilityConditions()` + `isBeforeShippingCutoff()`, `SHIPPING_CUTOFF_HOUR = 13`): made "today" a live clock check — replaced because the *result* of the same query changed just from the wall clock advancing past 13:00, independent of the data.
- **Current** (`shippingWindowRange()`, mirrored in `orders.repository.ts` — see `../order/summary-endpoints.md`): fixed window `[SHIPPING_WINDOW_START_HOUR_OPERATION, SHIPPING_WINDOW_END_HOUR_OPERATION)` = 06:00–14:00 BRT (`shared/utils/normalizers/date.ts`), checked as a **data** condition on each event's own timestamp (`emitted_at`, `batch.finished_at`, `batch.created_at`, `batch.delivery_note_generated_at`). A third constant, `SHIPPING_WINDOW_END_HOUR_OPERATION_AFTER_ESTIMATE_CUTOFF = 16`, is declared but **not currently referenced by any filter** — check before assuming it's wired up.

## Per-tab logic

- `orderNotCancelledCondition()`: `$order.id$ IS NULL OR $order.internal_status$ != CANCELLED`. Used only to *exclude* from `pending` — a note with no linked `Order` is never excluded (can't know it's cancelled).
- `pendingMercadoLivreWhere(storeName)`: returns literal `FALSE` outright (short-circuits) once `nowTz()` is past window end (14h). Otherwise: `batch_generated = false` AND `$unitBusinessAttributes.status$ IN (OPEN, PENDING)` (**bug fix**, eebc0c27 "Pending invoice filter on ship" — this status condition was missing before; without it a note with e.g. `FREE_TO_SCHEDULE`/`WAITING_SCHEDULE_SALES` status could wrongly show as pending) AND `orderNotCancelledCondition()` AND (linked order's `collection_date` today via `collectionDateDayRangeCompat()` OR `emitted_at` within today's window regardless of `collection_date`/linked order).
- `allTodayMercadoLivreWhere(storeName)`: union of `emitted_at`, `$batchInvoice.batch.finished_at$`, OR `$batchInvoice.batch.created_at$` (new clause, not in the cutoff-based design) within the window. Field name for batch creation is `created_at` on `ExpeditionBatch` — source has a not-yet-double-checked comment flagging this, confirm against the model if touched again.
- `finishedMercadoLivreWhere(storeName)`: `$batchInvoice.batch.finished_at$` in window AND `batch_generated = true` AND `$unitBusinessAttributes.status$ IN (FINISHED)` only — **narrowed** from the earlier design, which also accepted `CANCELLED`.
- `dispatchedMercadoLivreWhere(storeName)`: just `$batchInvoice.batch.delivery_note_generated_at$` in window — simplified from the earlier design (dropped the cutoff-condition ANDs it used to carry).
- `PENDING_INVOICE_ATTRIBUTE_STATUSES = ["PENDING", "OPEN"]` — duplicated as a hardcoded array literal in both this file and `orders.repository.ts`; a comment there flags "CONFIRMAR se existe enum próprio" — not currently a shared enum/constant.
