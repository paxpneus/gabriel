# Expedition batch entity

`src/modules/warehouse/expedition/`

Split by subject:
- This file — repository/scan-logs facts, auth, unmapped-products block
- `add-invoice-to-batch.md` — bulk `addInvoiceToBatch` rewrite + batch-numbering fix
- `last-outgoing-batch.md` — `last_outgoing_batch_pending` pointer mechanism

- `batch/batch.repository.ts` — `getFullBatch`/`getFullBatches` build a nested include (invoice, batchInvoices, items → product → productConfigs/stocks), all scoped by the batch's own `unit_business_id` via `buildFullIncludes(unitBusinessId)`. A `ProductConfig` include cross-store leak here was found and fixed — any future change to this include must keep `where: { unit_business_id }` on both the `ProductConfig` and `Stock` sub-includes.
- `scan-logs/scan-logs.service.ts` — matches a scanned physical label against `ProductConfig.gtin` (stripped of leading zeros too) OR the already-resolved `matchedCode` (SKU/mapping code). `gtin_package` matching removed in `m265` (see `../product/index.md`).
- `batch.controller.ts` (expedition) is in the HIGH unscoped-CRUD list — see `../../modules/auth.md`. Not fixed.
- **Blocked: adding an invoice with unmapped products to a batch**. Both `ExpeditionBatchService.generateBatchFromInvoices` and `.addInvoiceToBatch` call `unmappedInvoiceProductService.findUnmappedByInvoiceIds(invoiceIds, t)` (query lives in `UnmappedInvoiceProductRepository`, per the repository-owns-queries rule in root CLAUDE.md) and throw `"Nota(s) com produtos não mapeados: <numbers>"` before doing anything else if any targeted invoice still has `UnmappedInvoiceProduct` rows with `status: "UNMAPPED"`. In `generateBatchFromInvoices` this is scoped to `notBatched` (invoices actually about to be processed this call, not ones already batched) and sits right before the existing `assertTransshipment` loop.
