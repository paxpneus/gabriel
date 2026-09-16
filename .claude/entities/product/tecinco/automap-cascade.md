# Auto-map cascade (`autoMapExistingProductBySku`)

Shared fallback used by both Bling and Tecinco before registering an unmapped row or creating a new `Product` for a code with no `integration_mapping` yet. Tecinco genuinely has codes that collide across unrelated products (see `catalog-preflight.md` for its dedicated safety net); Bling collisions are rare, so this cascade stays as-is there.

In Bling's `fetchAndUpsertProduct` and Tecinco's `processProduct` (`bling-api-fetch.queue.ts` / `tecinco-api-fetch.queue.ts`), 2-level fallback:
1. `integration_mapping` (`resolveProductWithMapping`).
2. `resolveProductBySku(sku, logPrefix)` (`product.helpers.ts`) — `ProductConfig.findOne({where: {sku}})`, **global**, not scoped by `unit_business_id`/`integrations_id` (the same physical product may already exist via the other integration). Bling passes `blingProduct.codigo`, Tecinco passes `epctb_codigofabrica`.
3. `resolveProductBySupplierMapping(code, integrationsId, logPrefix)` — same code via `SupplierMapping.supplier_product_code`, scoped to the syncing integration.

Either match auto-maps to the existing product (creates the `integration_mappings` row, calls `unmappedInvoiceProductService.resolveFromCreatedProduct`) instead of duplicating the `Product`; runs before the `opts.create`/unmapped branch, so manual create-product tries this first too.

Carve-outs:
- KIT (Bling only, `formato === "E"`) never calls this — its `ProductConfig.sku` is synthesized, never expected to collide.
- Tecinco's `ensureProductsFromInvoiceItems` gets the same 2-level fallback, minus the mapping upsert (stays catalog-sync-only).
- `ensureSupplierMappings` (`product.helpers.ts`) creates a `SupplierMapping` for whichever of `ean`/`codigoFabrica`/`systemId` are present and not yet registered — all three, not EAN-only.
