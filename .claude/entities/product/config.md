# ProductConfig (`src/modules/inventory/product-config/`)

- Unique per `(product_id, unit_business_id)`: `sku`, `price`, `gtin`, `gtin_package`, `ncm`, `cest`, `supplier_cost_price`, `supplier_purchase_price`, avg-cost fields.
- `gtin_erp` (`m324`): raw EAN the ERP sends (primary mapping only; `SEM GTIN`/empty → null), written on every sync upsert **even when `gtin` is omitted** (override, `eanOmitted`, conflict). Read-only — never in resolution/search/filter/`queryConfig`/trigger; only the pending report reads it (`findErpEansInIntegration`, `findMissingErpEanInIntegration`). `findGtinOwnersInIntegration` = gtin owners across every unit business of the integration (EAN validation is per integration).
- Trigger `trigger_prevent_product_config_gtin_conflict` (`m264`, narrowed `m265`): blocks INSERT/UPDATE if `NEW.gtin` matches another product's `gtin` in the same `unit_business_id`. Doesn't touch `gtin_package`.
  - **Known false positive (current `m274` body)**: the lookup is `pc.product_id <> NEW.product_id` with no `pc.id <> NEW.id`, so an UPDATE that changes only `product_id` on a row with `gtin` matches the row itself (BEFORE trigger still sees the stored old `product_id`) and raises. Workaround when reassigning configs between products: set `product_id` with `gtin = NULL`, then restore `gtin` in a second UPDATE. Unfixed in the trigger.

## `gtin_package` removal (`m265`)

Deliberate — don't reintroduce as a matching fallback without checking with the user first. Used to be a fallback match alongside `gtin` in ~15 places (Bling sync, Tecinco resolution, NF-e XML import, warehouse label scan, order/report EAN display, DB conflict triggers). Removed because the same code could legitimately be one product's commercial `gtin` and a different product's `gtin_package` (tributary/package EAN) — DB triggers treated that as a conflict and blocked valid writes.

- Still a real column, still written (e.g. Bling's `gtinEmbalagem`) — just not read for matching/resolution/search/sort, not validated by any trigger.
- Remaining reads are pure passthrough/export only — `inventory-batch-logs.service.ts`'s `ean_tribut` field, `invoice.repository.ts` attributes list, `dump-local-products.ts`. Not resolution logic; leave as-is.
- `m265-drop-gtin-package-conflict-checks.js` narrows both `prevent_product_config_gtin_conflict` (`m264`) and `prevent_supplier_mapping_gtin_conflict` (`m263`, see `supplier-mapping.md`) to `gtin`-only.
