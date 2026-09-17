# Stock / StockMovement entity

`src/modules/inventory/stock/`

- `stock_movements` columns: `movement_type`, `direction`, `status`,
  `movement_quantity`, `balance_quantity`, `resulting_average_cost`,
  `unit_business_id`, `product_id`, `invoice_number`, `movement_date`.
  Anchor/correlation columns reference `invoice_number`, not a row id,
  because rows get hard-deleted and recreated.
  Has trigger `trigger_prevent_delete_manual_adjustment_with_cost`
  (BEFORE DELETE) that can block deleting a manual cost-adjustment
  movement.
- **`stock.controller.ts` has no auth at all (CRITICAL). `stock-movements.controller.ts`
  is unscoped by tenant (HIGH). Neither is fixed — see
  `.claude/modules/auth.md`.**
- **Fixed — `syncCsvBaseline` (`stock-movements.service.ts`) could leave two
  disconnected balance chains for the same product.** Any non-protected
  movement dated after `cutoffDate` used to be recalculated only if it was
  `PENDING` and dated after `extractionDate` (`pendingAfterExtraction`).
  An already-`SYNCHED` movement dated *inside* the sync window was correctly
  skipped from re-creation (dedup by `buildCsvEntryFingerprint`) but was
  **not** included in the recalculation timeline at all — so if a CSV row
  older than it, but never synced before, showed up in the same run (e.g.
  because `get-stock-movements.ts`'s `createScrapeWindow()` fell back to
  `INITIAL_CUTOFF_DATE` — `2024-07-01` — after `stock_movement_source_data`
  went empty, turning an incremental sync into a full historical re-scan),
  that older row's contribution to the balance never propagated past the
  stale `SYNCHED` movement. Confirmed in production: a product's balance sat
  at 0 through an existing `SALE_OUT`, then a brand-new `PURCHASE_ENTRY` of
  8 units two lines later showed `balance_quantity: 63`, because a
  never-before-synced 56-unit entry from over a year earlier got applied
  but never flowed through the untouched `SALE_OUT` in between. **Fixed**
  by widening what used to be `pendingAfterExtraction` to
  `existingMutableAfterCutoff` — every non-protected movement dated after
  `cutoffDate`, regardless of status — so an already-`SYNCHED` movement
  inside the window is recalculated (and updated in place if its result
  drifted) exactly like a future-dated `PENDING` one, instead of being
  treated as an immutable seed or silently dropped. Regression test:
  `stock-movements.test.ts` → `describe("syncCsvBaseline")`.
- `stock_movement_source_data` going empty (e.g. wiped by hand, or never
  populated because every prior `get-stock-movements.ts` run had
  `errors > 0` — that create is gated on `errors === 0 && isCompleteRun`,
  see `bling-nfe-scraping.md`) doesn't just lose the incremental cutoff, it
  makes the *next* run reprocess Bling's full history since
  `INITIAL_CUTOFF_DATE`. That's expensive and is what exposes the bug above;
  if `stock_movement_source_data` is unexpectedly empty in production,
  treat it as a signal that a prior extraction failed partway, not as
  routine cleanup.
