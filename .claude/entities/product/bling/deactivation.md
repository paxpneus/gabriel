# Bling product deactivation (`situacao=E`)

Bling's product payload carries `situacao` (`"A"` active, `"E"` excluded/deactivated) — `fetchAndUpsertProduct` didn't read it before; a Bling-deleted product kept being treated as active on every sync.

Now, at the top of `fetchAndUpsertProduct`, right after `logPrefix`, before mapping-resolution/KIT/unmapped logic:
- **Strict** `blingProduct.situacao === "E"` check — any other value (`undefined`/`"A"`) falls through unchanged. Deliberate: a looser check risks touching active products on an API field-shape surprise.
- On match, `productService.retireFromIntegration({ integration, externalId: blingId })` takes over completely; normal flow (KIT sync, Magento sync, `ProductConfig`/`Stock` upsert, kardex, unmapped registration) is skipped — **no `UnmappedInvoiceProduct` row is ever created** for a `situacao=E` product, by design.
- Resolves the local `Product` via `integrationMappingService.findEntityByMapping` (mapping-only, no EAN `SupplierMapping` backfill — it would be deleted right after). No mapped product → no-op.

## `ProductService.retireFromIntegration` design

One method for both integrations (`products/services/product.service.ts`); the queues only call it with their integration + code.

**Reverted design**: an earlier version hard-deleted the `Product` row (+ `invoice_items`/`stock_movements`, guarded by `MANUAL_ADJUSTMENT` stock-movement and `batch_invoice_items` pre-checks). Too fragile: real products kept hitting unguarded `RESTRICT` FKs (`expedition_batch_items`, `inventory_batch_items`, `kit_components.product_component_id`), needing manual SQL cleanup. Replaced with the current design below.

Current design — never deletes `Product`, `invoice_items`, or `stock_movements` (history stays intact, no `RESTRICT` FK risk). Instead, in one transaction, strips only what belongs to the **given integration**:
- `integrationMappingService.bulkDelete` — `integration_mappings` `PRODUCT` of the product **in that integration only**; other integrations' mappings stay.
- `supplierMappingService.bulkDelete` — `SupplierMapping` rows with `integrations_id` = that integration.
- `productConfigService.bulkDelete` — `ProductConfig` of that integration's stores only (`unit_business_id IN` stores with `unit_businesses.integrations_id` = it).
- `is_active: false` (`productRepository.update`) — **only if no `integration_mappings` `PRODUCT` is left in any integration**. Still mapped elsewhere → product stays active (and keeps showing in tire search, which filters `is_active`).

**Tecinco** (`tecinco-api-fetch.queue.ts`) calls the same method with the Tecinco integration. Tecinco has no webhook and its payload has no status field, so "deleted" is detected by **HTTP 404 on `GET /produtos/:codigo`** (`obterProduto`): in `processProduct`'s grupo/subgrupo backfill (sync → retire and skip the upsert) and in `ensureProductsFromInvoiceItems` (retire; item continues without detail, so it falls to the normal unmapped/fallback path). The manual-create path's 404 keeps its `UnrecoverableError` (code comes from an unmapped item, no mapping to retire). The `action === "deleted"` branch calls it too.

**Audit**: writes **one** `PRODUCT` audit entry in the same transaction (`productRetiredFromIntegrationAudit` em `inventory/products/helpers/audit.ts`, `origin: SYSTEM`, `user_id` null): summary with integration + code, `is_active` before→after only when deactivated, removed mappings/`SupplierMapping` (with `is_physical_override`)/`ProductConfig` in `affected`. A removed confirmed physical EAN is also called out in the summary ("Confirmação de EAN físico removida: …") — it is deleted only on full retirement from that integration, never on the duplicated-primary exception. Truthfulness: product + rows to remove are read with `lock: t.LOCK.UPDATE` (before), deleted by `id IN` of the locked rows with count check (mismatch → throw → rollback, no audit), and `is_active` after is re-read inside the transaction.

**Exception — duplicated primary code**: if the deactivated code is the product's primary but the product has another Bling code, `integrationMappingService.retirePrimaryCodeIfDuplicated` deletes only that mapping via `deleteForProduct(..., deletedInIntegration)` (promotes the next; audit `origin: SYSTEM`, `user_id` null, summary "excluído no <integração>… o código X virou o principal") and the product is **not** retired — the usual cleanup of a duplicate registration in the ERP. Same for Tecinco. Non-primary codes are ignored (only read-only).

Self-terminating: once the mapping is gone, the next `situacao=E` event for that `blingId` can't resolve a local product at all → hits the no-op branch. No re-attempt, no unmapped row, no update.

`BatchInvoiceItemsRepository`/`Service.findBlockingByProductId` (the `quantity_read` guard from the reverted design) deleted as dead code — its only caller was the hard-delete path.

## Webhook wiring

`bling-webhook.mapper.ts`'s `mapProduct` used to special-case `action === "deleted"` into a `directUpsert: {table: "delete", ...}` job on `BlingDirectUpsertQueue`, whose `handleDelete` just set `is_active: false` — no dependent-row cleanup, no `situacao` awareness. `product.deleted` now routes through the **same** `requiresApiFetch` path as `created`/`updated` (no more action special-casing in `mapProduct`) — `BlingApiFetchQueue.fetchAndUpsertProduct` fetches the current product and decides from the fresh `situacao` (Bling's "delete" isn't real deletion; the product flips to `situacao=E`, still fetchable at `/produtos/:id`). `BlingDirectUpsertQueue.handleDelete`'s `"product"` case removed as dead code (superseded by `productService.retireFromIntegration`); `"invoice"`/`"consumer_invoice"`/`"product_supplier"` deletes unaffected.
