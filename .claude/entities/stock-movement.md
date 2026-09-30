# Stock / StockMovement entity

`src/modules/inventory/stock/`

- `stock_movements` columns: `movement_type`, `direction`, `status`,
  `movement_quantity`, `balance_quantity`, `resulting_average_cost`,
  `unit_business_id`, `product_id`, `invoice_number`, `movement_date`,
  + valores da nota (m295, todos NULL-áveis): `gross_total_amount`,
  `net_total_amount`, `unit_discount_amount`, `discount_amount`,
  `discount_percentage`, `unit_price_invoice` (`preco` do lançamento Bling),
  `bling_entry_ids` (`lancamento_id`, `"a+b"` quando NF mesclada),
  `bling_origin_id` (`idOrigem`). Loja 21 = `unit_businesses.number='21'`
  (`CD21_UNIT_BUSINESS_NUMBER`); não existe `store_id`.
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
- **`isProtected` stays `m.refers_to != null` in both `reindexProduct` and
  `syncCsvBaseline` — `manual_average_cost_value` alone never needs to be
  in that check.** `calculateNextState`'s override block re-applies
  whatever `manual_average_cost_value` is stored on a movement every time
  it's called, protected or not — so recalculating a non-anchored
  `MANUAL_ADJUSTMENT` (via `existingMutableAfterCutoff`, previous bullet)
  already updates its `balance_quantity` correctly while its cost stays
  fixed, with no special-casing needed.
- **Fixed a real gap in the `refers_to`-anchored (`protected`) branch of
  `syncCsvBaseline`'s timeline loop, though: it used to be a pure
  pass-through** — it read the anchored movement's *already-stored*
  `balance_quantity`/`resulting_average_cost` straight into `previousState`
  for whatever comes next, without ever recalculating the anchored
  movement itself. `refers_to` should freeze the **cost**
  (`resulting_average_cost`/`manual_average_cost_value` are the deliberate
  fact being protected) but the **balance still has to track the real
  chain** — if an older, newly-discovered entry lands before it in the
  timeline (same full-rescan scenario as the bullets above), the anchored
  row's balance needs to shift too, or it desyncs from what actually came
  before it. **Fixed** by calling `calculateNextState` for the `protected`
  entry same as any other, then discarding its computed cost and forcing
  `resulting_average_cost` back to the movement's own stored value before
  pushing to `toUpdate` — so only `balance_quantity` (and
  `total_stock_value`, derived from it) can drift and get written; the
  anchored cost never changes. Regression tests: `stock-movements.test.ts`
  → `describe("syncCsvBaseline")` → the two tests contrasting a bare
  `MANUAL_ADJUSTMENT` (no `refers_to`) vs an anchored one.
- `stock_movement_source_data` going empty (e.g. wiped by hand, or never
  populated because every prior `get-stock-movements.ts` run had
  `errors > 0` — that create is gated on `errors === 0 && isCompleteRun`,
  see `bling-nfe-scraping.md`) doesn't just lose the incremental cutoff, it
  makes the *next* run reprocess Bling's full history since
  `INITIAL_CUTOFF_DATE`. That's expensive and is what exposes the bug above;
  if `stock_movement_source_data` is unexpectedly empty in production,
  treat it as a signal that a prior extraction failed partway, not as
  routine cleanup.

## Valores da nota / desconto (PURCHASE_ENTRY)

- Ordem canônica do Kardex: `movement_date, created_at, id` por
  `product_id + unit_business_id`, só `is_active`. Sem coluna de sequência.
- Desconto vive num `MANUAL_ADJUSTMENT` com `refers_to = invoice_number` da
  entrada (`qty=0` tipicamente). `computePurchaseEntryDiscounts`
  (`helpers/purchase-entry-discount.ts`, puro, BigInt escala 4):
  `net = total_stock_value(pós-ajuste) - total_stock_value(pré-entrada)`;
  sem ajuste `net = qty * unit_cost_invoice`; `gross = qty * unit_cost_invoice`;
  `discount = gross - net`; `unit_discount = unit_cost - net/qty`;
  `pct = discount/gross*100` (DECIMAL(5,2); fora de ±999.99 vira NULL).
  Mais de um ajuste pra mesma NF: vale o último. Ajuste com `qty>0`: tira
  `±qty * resulting_average_cost` do `total_stock_value` pra isolar o custo.
- `qty=0` / `gross=0` / sem `unit_cost_invoice`: `unit_discount_amount` e
  `discount_percentage` (ou tudo) ficam NULL — nunca 0. Anomalias
  (`multiple_adjustments`, `non_adjacent_adjustment`, `adjustment_with_quantity`,
  `negative_discount`, `negative_previous_balance`, `missing_unit_cost`,
  `percentage_out_of_range`) são só logadas/contadas.
- `StockMovementService.recalculatePurchaseEntryDiscounts(productIds, ub, tx)`
  roda no fim de `syncCsvBaseline`, `reindexProduct` e
  `upsertProductStockMovements`; UPDATE em lote via `unnest` com
  `IS DISTINCT FROM` (idempotente). Backfill histórico:
  `src/scripts/stock/backfill-purchase-entry-discounts.ts`
  (`UNIT_BUSINESS_ID`, `DRY_RUN` default true = rollback, `BATCH_SIZE`=200,
  `MAX_PRODUCTS`); 2ª execução reporta `alteradas=0`.
- `preco` Bling: `populate-stock-movements.ts` lê `preco` (E/S) via
  `parseBlingEntryPrice` (`shared/utils/normalizers/bling/stock-entry-price.ts`;
  ausente/zero/inválido = NULL, contados no log final); NF mesclada usa média
  ponderada (`weightedAveragePrice`). `syncCsvBaseline` grava nas linhas novas e,
  pra lançamento já SYNCHED casado por fingerprint, faz fill-only
  (`fillMissingInvoiceValues`, COALESCE — nunca sobrescreve). `reindexProduct`
  preserva `unit_price_invoice`/`bling_*` da linha apagada equivalente.
  Dedup de criação continua por `buildCsvEntryFingerprint`, não pelo id Bling.
  `tipoEntrada` do Bling é ignorado (só existe no CSV).
- Aritmética monetária: `shared/utils/normalizers/decimal.ts` (BigInt, sem
  float). Pedido de venda do CSV vira `MANUAL_ADJUSTMENT` OUT com
  `invoice_number` = nº do pedido (não `SALE_OUT`).
