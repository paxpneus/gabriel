# Invoice entity (fiscal)

`src/modules/warehouse/fiscal/invoices/`

- `invoice/` — `Invoice` model/service/repository/controller + `invoice-label.service.ts` (EAN for printed labels) + `helpers/totals.ts` (`totalExpectedLiteral`/`totalReadLiteral`).
- `invoice-items/` — `InvoiceItems`; resolves product/config per line — see `item-resolution.md`.
- `InvoiceFiscalItem` — sibling model, own `invoice-fiscal-item/` folder, **no repository/service/controller of its own** (just `.model.ts`/`.types.ts`) — queried/written directly wherever needed (`invoice.repository.ts`, `invoice.service.ts`, `invoice-items.service.ts`). Same accepted no-layer exception applies to `SalesOrderItemSnapshot`/`KitComponent` reads in this module (see `supplier-discount/report-value.md`).

Split by subject:
- `item-resolution.md` — product/config resolution order, unmapped-product reconciliation cascade, related bug fixes
- `ml-shipping-filters.md` — Mercado Livre shipping-queue filters
- `supplier-discount/filter.md` — `rim`/`supplier_discount` invoice filters
- `supplier-discount/report-value.md` — per-line discount value/rule in reports
- `supplier-discount/unit-business-bypass.md` — report-only ignore-unit-business bypass

## FK on `invoices` row delete
- **RESTRICT**: `stock_movements.invoice_id`, `orders.invoice_id`.
- **SET NULL**: `operations.invoice_id`, `sales_order_snapshots.invoice_id`.
- **CASCADE**: `expedition_batch_invoices`, `invoice_fiscal_items`, `invoice_items`, `invoice_logistic_occurrences`, `invoice_operation_snapshots`, `invoice_unit_business_attributes`, `unmapped_invoice_products`.

## Misc fixes/filters
- **New `transporterStatus` filter on `listInvoices`** — `?filters[transporterStatus]=pending-<transporterId>` (`InvoiceRepository.extractTransporterStatusFilter`). Filters `unitBusinessAttributes.status IN (PENDING, OPEN)`, `batch_generated = false`, `Invoice.transporter_id = <transporterId>`, and excludes Mercado Livre notes (`store.name != "MercadoLivre"`, `store` include becomes `required: true` with that `where` only when this filter is active). Meant to open the invoice listing pre-filtered from a `pending_batch_by_transporter` card click (`OrderService.getOrdersStatusSummary`, `.claude/entities/order/summary-endpoints.md`) — only `pending-` prefix is parsed today, no other status prefix implemented.
- **`processStatus` filter replaced the old boolean `pendingProcess`** (`invoice.service.ts`/`invoice.repository.ts`) — now 3-value: `pendingProcess` (`status NOT IN (FINISHED, CANCELLED)`, status-only now — the old version also OR'd in `batch_generated = false`, that's gone), `finishedProcess` (`batch_generated = true AND status IN (FINISHED, CANCELLED)` — `printed_label = true` dropped, no longer required), `notStartedProcess` (new — `status IN (OPEN, PENDING) AND batch_generated = false`).
- `InvoiceRepository.listInvoices`'s attribute exclude list now also drops `xml_path` (alongside `source_payload`) from the paginated listing response.
- **Fixed — `getInvoiceProductReport`'s "default seller" fallback pointed at a dead hardcoded UUID.** Was `userService.findById(default_seller)` (module-level constant `"5ff76374-4d67-4ef3-a566-349a015f86b1"`, stopped resolving). Now `userService.findOne({ where: { name: "Rafael Minetto" } })` — the constant is still declared but unused.
- **Fixed — `getFullInvoiceForAllUnits` crash on Bling notes without `chaveAcesso` yet**: `fetchAndUpsertInvoice` looked up the pre-existing invoice by `xml_key` only. A note pending SEFAZ authorization (`situacao: 1`) has no `chaveAcesso`, so the lookup args were both `undefined` and the repository's own guard threw — crashing every retry forever even though the note already existed in the DB under `id_system = String(nf.id)`. Fixed: `getFullInvoiceForAllUnits(invoiceId?, invoiceKey?, idSystem?)` now also matches by `id_system` when no `invoiceId` is given; Bling passes `String(nf.id)`. `invoice-xml.ts`'s own `findByIdFullForAllUnits` call (Tecinco/manual XML import) unchanged — that flow always has a `chaveAcesso`.

## Auth
`invoice.controller.ts` has HIGH-severity scoping gaps — see `../../modules/auth.md`. Not fixed: `show`/`destroy`/`create` unscoped; other actions trust a client-supplied `?unitBusinessId=` over the logged user's own; DANFE/XML batch downloads have no store filter.
