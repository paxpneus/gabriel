# Auto-map cascade (Bling: `autoMapExistingProductBySku`; Tecinco: `autoMapExistingProductBySupplierMapping`)

Fallback used by both Bling and Tecinco before registering an unmapped row or creating a new `Product` for a code with no `integration_mapping` yet. Tecinco genuinely has codes that collide across unrelated products (see `catalog-preflight.md` for its dedicated safety net) — for Tecinco, resolving by `ProductConfig.sku` (global, unscoped) is out of the question, so its cascade dropped that step entirely. Bling collisions are rare, so its cascade keeps the SKU step.

In Bling's `fetchAndUpsertProduct` (`bling-api-fetch.queue.ts`), 3-level fallback:
1. `integration_mapping` (`resolveProductWithMapping`).
2. `resolveProductBySku(sku, logPrefix)` (`product.helpers.ts`) — `ProductConfig.findOne({where: {sku}})`, **global**, not scoped by `unit_business_id`/`integrations_id` (the same physical product may already exist via the other integration). Bling passes `blingProduct.codigo`.
3. `resolveProductBySupplierMapping(code, integrationsId, logPrefix)` — same code via `SupplierMapping.supplier_product_code`, scoped to the syncing integration.

In Tecinco's `processProduct` (`tecinco-api-fetch.queue.ts`), 2-level fallback (no SKU step):
1. `integration_mapping` (`resolveProductWithMapping`).
2. `resolveProductBySupplierMapping(codigoFabrica, integrationsId, logPrefix)` — `epctb_codigofabrica` via `SupplierMapping.supplier_product_code`, scoped to the Tecinco integration.

Either match auto-maps to the existing product (creates the `integration_mappings` row, calls `unmappedInvoiceProductService.resolveFromCreatedProduct`) instead of duplicating the `Product`; runs before the `opts.create`/unmapped branch, so manual create-product tries this first too.

Carve-outs:
- KIT (Bling only, `formato === "E"`) never calls this — its `ProductConfig.sku` is synthesized, never expected to collide.
- Tecinco's `ensureProductsFromInvoiceItems` gets the same fallback as `processProduct` (mapping → `resolveProductBySupplierMapping`, no SKU step), minus the mapping upsert (stays catalog-sync-only).
- `ensureSupplierMappings` (`product.helpers.ts`) creates a `SupplierMapping` for whichever of `ean`/`codigoFabrica`/`systemId` are present and not yet registered — all three, not EAN-only.
- `resolveProductBySku` still exists in `product.helpers.ts` and is still used by Bling — it's just no longer called anywhere in the Tecinco queue.
