# SupplierMapping (`src/modules/inventory/supplier-mapping/`)

- Table `product_supplier_maps`: `product_id`, `supplier_cnpj`, `supplier_product_code`, `integrations_id`.
- Unique index `product_supplier_maps_integrations_id_code_unique (integrations_id, supplier_product_code)` since `m263` — replaced an older `(product_id, supplier_product_code)` unique that blocked the same code mapping to different products across different integrations (legitimate case).
- Trigger `trigger_prevent_supplier_mapping_gtin_conflict` (`m263`, narrowed `m265`): `supplier_product_code` can't equal another product's `ProductConfig.gtin` within the same integration (joins `unit_businesses.integrations_id`). No longer checks `gtin_package`.
- `supplierMappingService.findByProductCode(code, unitBusinessId)` — resolves `integrations_id` for the unit business then looks up the mapping. Reuse this instead of duplicating the `findOne`.
- `supplierMappingService.createFromUnmapped({ productId, unmappedInvoiceProductId, supplierCnpj? })` — maps an `UnmappedInvoiceProduct` to an **already-existing** `Product`, without going through `InvoiceItems`. `POST /supplier-mapping/from-unmapped`. Mainly for catalog-scoped unmapped rows (`invoice_id: null`, no invoice to attach an item to).
  - Code = `unmapped.ean ?? unmapped.sku`; `integrations_id` from the unmapped row.
  - Idempotent if the mapping already exists and points at the **same** `product_id` — no re-insert attempt. Throws only if it points at a **different** product.
  - If `unmapped.external_id` is set, also calls `integrationMappingService.createOrUpdateIntegrationMapping(...)` — otherwise the next catalog sync wouldn't find the mapping and would recreate the unmapped row.
  - Deletes the `UnmappedInvoiceProduct` row. All in one transaction.
  - Controller checks `unmapped.integrations_id` against the caller's own resolved integration first (same ownership-check pattern as `show`/`update`/`destroy`).
