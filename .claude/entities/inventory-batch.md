# InventoryBatch entity

`src/modules/inventory/stock-inventory/inventory-batch/`, `inventory-batch-items/`, `inventory-batch-logs/`.

- `InventoryBatch` (`mode`: `FIXED`/`CYCLIC`, `type`: `REGULAR`/`DIVERGENCY`, `status`: `OPEN`/`PENDING`/`FINISHED`) belongs to a `unit_business_id`.
- **FIXED**: `inventoryBatchService.createInventoryBatch` pre-populates every `InventoryBatchItems` row synchronously, from all `type: "UNIT"` products with stock in that unit business.
- **CYCLIC**: no items are pre-created — `InventoryBatchLogsService.scanProduct` (scan-by-EAN) lazily upserts an `InventoryBatchItems` row the first time each product is scanned.
- **Integration-mapping gate (both modes)**: only products with a valid `integration_mappings` row (`entity_type: "PRODUCT"`) for the unit business's own `integrations_id` (`unit_businesses.integrations_id`) may get an `InventoryBatchItems` row. If the unit business has no `integrations_id` configured, nothing qualifies — FIXED creates an empty batch, CYCLIC's `scanProduct` rejects every scan. Checked via `integrationMappingService.findExternalIdsMap("PRODUCT", integrations_id, productIds)`. FIXED filters the whole candidate product list before `bulkCreate`; CYCLIC checks the single scanned product before `upsertItem`, right after resolving it and before the subgroup check.
