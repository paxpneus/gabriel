# Bling product deactivation (`situacao=E`)

Bling's product payload carries `situacao` (`"A"` active, `"E"` excluded/deactivated) — `fetchAndUpsertProduct` didn't read it before; a Bling-deleted product kept being treated as active on every sync.

Now, at the top of `fetchAndUpsertProduct`, right after `logPrefix`, before mapping-resolution/KIT/unmapped logic:
- **Strict** `blingProduct.situacao === "E"` check — any other value (`undefined`/`"A"`) falls through unchanged. Deliberate: a looser check risks touching active products on an API field-shape surprise.
- On match, `handleDeactivatedBlingProduct` takes over completely; normal flow (KIT sync, Magento sync, `ProductConfig`/`Stock` upsert, kardex, unmapped registration) is skipped — **no `UnmappedInvoiceProduct` row is ever created** for a `situacao=E` product, by design.
- Resolves the local `Product` via `resolveProductWithMapping` (mapping-only). No mapped product → no-op.

## `handleDeactivatedBlingProduct` design

**Reverted design**: an earlier version hard-deleted the `Product` row (+ `invoice_items`/`stock_movements`, guarded by `MANUAL_ADJUSTMENT` stock-movement and `batch_invoice_items` pre-checks). Too fragile: real products kept hitting unguarded `RESTRICT` FKs (`expedition_batch_items`, `inventory_batch_items`, `kit_components.product_component_id`), needing manual SQL cleanup. Replaced with the current design below.

Current design — never deletes `Product`, `invoice_items`, or `stock_movements` (history stays intact, no `RESTRICT` FK risk). Instead, in one transaction, strips every reference that makes the product reachable by code:
- `integrationMappingService.bulkDelete({where: {entity_type: "PRODUCT", internal_id: product.id}})` — all `integration_mappings`, across **every** integration (Bling and Tecinco), not just the reporting one. Retired from one channel = retired everywhere.
- `supplierMappingService.bulkDelete({where: {product_id: product.id}})` — all `SupplierMapping` rows.
- `productConfigService.bulkDelete({where: {product_id: product.id}})` — all `ProductConfig` rows (loses `sku`/`gtin`/`price` per store).
- `productService.update(product.id, {is_active: false})` — reuses `is_active` (`m256`); nothing wrote `false` to it since the old delete-handler was removed (see webhook wiring below).

Self-terminating: once the mapping is gone, the next `situacao=E` event for that `blingId` can't resolve a local product at all → hits the no-op branch. No re-attempt, no unmapped row, no update.

`BatchInvoiceItemsRepository`/`Service.findBlockingByProductId` (the `quantity_read` guard from the reverted design) deleted as dead code — its only caller was the hard-delete path.

## Webhook wiring

`bling-webhook.mapper.ts`'s `mapProduct` used to special-case `action === "deleted"` into a `directUpsert: {table: "delete", ...}` job on `BlingDirectUpsertQueue`, whose `handleDelete` just set `is_active: false` — no dependent-row cleanup, no `situacao` awareness. `product.deleted` now routes through the **same** `requiresApiFetch` path as `created`/`updated` (no more action special-casing in `mapProduct`) — `BlingApiFetchQueue.fetchAndUpsertProduct` fetches the current product and decides from the fresh `situacao` (Bling's "delete" isn't real deletion; the product flips to `situacao=E`, still fetchable at `/produtos/:id`). `BlingDirectUpsertQueue.handleDelete`'s `"product"` case removed as dead code (superseded by `handleDeactivatedBlingProduct`); `"invoice"`/`"consumer_invoice"`/`"product_supplier"` deletes unaffected.
