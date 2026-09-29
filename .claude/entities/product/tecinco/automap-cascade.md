# Auto-map cascade (Bling: `autoMapExistingProductBySku`; Tecinco: `autoMapExistingProductBySupplierMapping`)

Fallback used by both Bling and Tecinco before registering an unmapped row or creating a new `Product` for a code with no `integration_mapping` yet. Tecinco genuinely has codes that collide across unrelated products (see `catalog-preflight.md` for its dedicated safety net) — for Tecinco, resolving by `ProductConfig.sku` (global, unscoped) is out of the question, so its cascade dropped that step entirely. Bling collisions are rare, so its cascade keeps the SKU step.

In Bling's `fetchAndUpsertProduct` (`bling-api-fetch.queue.ts`), 3-level fallback:
1. `integration_mapping` (`resolveProductWithMapping`).
2. `resolveProductBySku(sku, logPrefix)` (`product.helpers.ts`) — `ProductConfig.findOne({where: {sku}})`, **global**, not scoped by `unit_business_id`/`integrations_id` (the same physical product may already exist via the other integration). Bling passes `blingProduct.codigo`.
3. `resolveProductBySupplierMapping(code, integrationsId, logPrefix)` — same code via `SupplierMapping.supplier_product_code`, scoped to the syncing integration.

In Tecinco's `processProduct` (`tecinco-api-fetch.queue.ts`), 2-level fallback (no SKU step):
1. `integration_mapping` (`resolveProductWithMapping`).
2. `resolveProductBySupplierMapping(codigoFabrica, integrationsId, logPrefix)` — `epctb_codigofabrica` via `SupplierMapping.supplier_product_code`, scoped to the Tecinco integration.

Either match auto-maps to the existing product (creates the `integration_mappings` row, calls `unmappedInvoiceProductService.resolveFromCreatedProduct({ externalId, integrationsId, productId })`) instead of duplicating the `Product`; runs before the `opts.create`/unmapped branch, so manual create-product tries this first too. `resolveFromCreatedProduct` now needs `productId` (not just `externalId`/`integrationsId`) because it also closes `invoice_id`-linked unmapped rows for that same `external_id` (see `create-flow.md` for what it does with each).

Carve-outs:
- KIT (Bling only, `formato === "E"`) never calls this — its `ProductConfig.sku` is synthesized, never expected to collide.
- Tecinco's `ensureProductsFromInvoiceItems` (invoice resolution) **no longer has this fallback at all** — it resolves strictly via `integration_mapping`; no match means an immediate `ERROR_CATALOG` unmapped row (`type`/`external_id` set, see `catalog-preflight.md`'s history of why the fallback was there and why it got removed instead of just gated). The `resolveProductBySupplierMapping`/duplicate-catalog fallback stays exclusive to `processProduct` (catalog sync).
- `ensureSupplierMappings` (`product.helpers.ts`) creates a `SupplierMapping` for whichever of `ean`/`codigoFabrica`/`systemId` are present and not yet registered — all three, not EAN-only. `ensureProductsFromInvoiceItems` no longer calls it either (no fallback to backfill for, in that function): SupplierMapping backfill from Tecinco data stays exclusive to `processProduct`'s own per-filial loop.
- `resolveProductBySku` still exists in `product.helpers.ts` and is still used by Bling — it's just no longer called anywhere in the Tecinco queue.
