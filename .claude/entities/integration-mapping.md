# IntegrationMapping entity

`src/modules/integrations/integration-mapping/`

- Table `integration_mappings`: `entity_type` (`"PRODUCT"`, `"CONTACT"`, ...), `internal_id`, `integrations_id`, `external_id` — maps a local entity to its id in an external system (Bling/Tecinco).
- `integrationMappingService.findGroupedMappingsMap(...)` / `.findExternalIdsMap(...)` — bulk-enrich rows (e.g. `order_items.service.ts`) with external ids. `findExternalIdsMap` prefers the primary mapping.

## `is_primary` (`m323`) and `erp_data` (`m325`)

- **`is_primary`**: one primary per `(entity_type, internal_id, integrations_id)` (partial unique `uq_integration_mappings_primary`). Backfill: oldest mapping became primary. New mapping is born primary when the product has none in that integration (`createOrUpdateIntegrationMapping`/`createForProduct`); `deleteForProduct` promotes the next oldest (`promoteOldestIfNoPrimary`). Read-only list of products with 2+ mappings: `src/scripts/list-products-with-multiple-mappings.ts`.
- **Sync gate** (Tecinco `processProduct`, Bling `fetchAndUpsertProduct`): the mapping resolves the product normally (not unmapped), but a **non-primary** mapping writes nothing (ProductConfig price/stock/gtin/sku/`gtin_erp`, Stock, SupplierMapping), only `erp_data`, then returns. `deleted`/deactivation coming through a non-primary mapping is ignored.
- **`erp_data` JSONB** (PRODUCT only): read-only snapshot of what that external code says, written for primary **and** non-primary (`updateErpData`, one write per job). Bling `buildBlingProductErpData` (`name, ean, ean_package, sku, stock`), Tecinco `buildTecincoProductErpData` (`name, ean` via `normalizeEan`, `sku, stocks[]` per branch with `unit_business_id`/`unit_business_name` from the cached lookup — snapshot, name may be stale until next sync), both with `updated_at`. Never used in resolution; consumed by the pending report (`../modules/integration-pending-report.md`).
- `integrationMappingService.createOrUpdateIntegrationMapping(...)` — despite the name, **never updates/reassigns an existing mapping**. If a row already exists for that `external_id` (see conflict-scope fix below), it `console.warn`s and returns the existing row unchanged — no exception.

## Orphaned-mapping incident (`m268`)

`internal_id` is a plain varchar, not a real FK — deleting a `Product` did **not** clean up its `integration_mappings` rows, leaving an orphaned mapping permanently squatting that `external_id`. Next time that external product needed a new local `Product` (`UnmappedInvoiceProductService.createProduct` → `createProductFromBlingData`/`createProductFromTCarData`, both call `createOrUpdateIntegrationMapping` right after creating the product), the create succeeded but the mapping step silently no-op'd against the stale orphan — new product ends up with **no** mapping, nothing surfaced beyond a `console.warn`.

**Confirmed in prod (Tecinco)**: user manually mapped ~53 `ERROR_CATALOG` rows for one unit_business; ~4h later 38 `ERROR_CATALOG` rows reappeared, 34 the same products just mapped. Not a per-branch scoping bug (`unit_businesses.integrations_id` is shared tenant-wide, `epctb_codigo` is itself global — mapping once is correct). Real sequence: pre-`m268` deletion had orphaned the mapping; create-product made a new `Product` fine, but `createOrUpdateIntegrationMapping` no-op'd against the stale orphan instead of writing the new mapping; `resolveFromCreatedProduct` deleted the unmapped row regardless, so the mapping *looked* successful. Next catalog sync's `resolveProductByMappingOnly` found the orphan, resolved no `internal_id`, and re-registered the item as a brand-new unmapped row — indistinguishable from "never mapped." DB check found 21 such orphaned `PRODUCT`/Tecinco mappings.

**Fixed going forward**: `trigger_delete_integration_mapping_on_product_delete` (`AFTER DELETE ON products`) deletes any `integration_mappings` row with `entity_type='PRODUCT'` and matching `internal_id`. Only touches `entity_type='PRODUCT'` — other entity types unaffected. `createOrUpdateIntegrationMapping`'s silent-no-op-on-conflict itself is unchanged, and **orphan rows created before this migration are not backfilled** — pre-existing orphan backlog still needs a one-off cleanup (delete `integration_mappings` rows whose `internal_id` has no matching row in the table named by `entity_type`) before those specific products can be re-mapped successfully. (The `id_system` conflict guard mentioned in earlier investigation of this incident no longer exists — `products.id_system` was removed entirely, see `product/core.md`; unrelated to the orphan backlog, which is still unresolved.)

## Conflict-scope fix — was blocking by `internal_id`, not just `external_id`

Second, distinct prod incident (Tecinco): a product had a valid mapping for `external_id=20517`; the *same physical product* legitimately also had a different `external_id=13216` (confirmed normal on Tecinco — one tire can get more than one `epctb_codigo` across filiais/duplicate catalog entries). Mapping the `13216` row via `supplierMappingService.createFromUnmapped` created the `SupplierMapping` fine, but the old existence check — `where: {entity_type, integrations_id, [Op.or]: [{internal_id}, {external_id}]}` — matched the existing `20517` row purely by `internal_id`, so the `13216` mapping silently never got created (same no-op, different root cause: not orphaned, just an unrelated existing mapping for the same product). Every subsequent sync re-registered `13216` as unmapped, forever.

**Fixed**: existence check now scoped to `external_id` only — a mapping is refused only when *that exact* `external_id` already points at a *different* `internal_id` (the real conflict this function guards against). The same `internal_id` having other `external_id` rows in the same integration is now explicitly allowed. Covered by `integration-mapping.service.test.ts` ("mesmo internal_id já tem mapping pra outro external_id: cria um novo mesmo assim").

## Routes

Generic `PUT/DELETE /:id` and bulk variants return 405 — sync never repoints a mapping. Manual correction only via product-scoped routes (all where `entity_type: "PRODUCT"` + `internal_id = productId`, not tenant-scoped, `integrations_id` comes from body):

- `GET /integration-mapping/product/:productId` → `findByProductId`: paginated via `repository.findPaginated` forced where.
- `POST /integration-mapping/product/:productId` → `createForProduct` (body `integrations_id`, `external_id`): checks `Product` exists first (`internal_id` isn't an FK — avoids creating an orphan). Unique `(entity_type, integrations_id, external_id)` violation → 400, not silent no-op like `createOrUpdateIntegrationMapping`.
- `PUT /integration-mapping/product/:productId/:id` → `updateForProduct`: changes only `integrations_id`/`external_id`/`is_primary` (sent fields); `internal_id` fixed. 404 if not that product. `is_primary: true` unmarks the product's other mappings in that integration in the same transaction (audited); `is_primary: false` → error (choose another as primary instead).
- `DELETE /integration-mapping/product/:productId/:id` → `deleteForProduct`: deleting makes the next catalog sync re-register that external product as unmapped; promotes the next primary if the deleted one was primary.

## Auth

Controller exige `authenticate` em todo CRUD (antes `index`/`show`/`create` eram abertos); ainda não escopado por tenant — ver `../modules/auth.md`.
