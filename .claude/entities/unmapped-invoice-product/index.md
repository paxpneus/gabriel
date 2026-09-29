# UnmappedInvoiceProduct entity

`src/modules/inventory/unmapped-invoice-product/`

Despite the name: a general "needs manual mapping" review queue, **not only** for invoice line items. Split by subject:
- This file — schema, dedup rules, `type` column, upsert behavior
- `create-flow.md` — create-a-real-Product-from-an-unmapped-row flow, including the combined create+cascade-map-to-invoice flow (`createProductAndMapToInvoice`)

Rows come from two flows, distinguished by `invoice_id`:
- **`invoice_id: null`** — created during an integration's *product catalog* fetch/sync (not from an invoice), when the fetched product has no `integration_mapping` yet. `bling-api-fetch.queue.ts`'s `fetchAndUpsertProduct` and `tecinco-api-fetch.queue.ts` (reason `"Produto novo, precisa de mapeamento manual"`). Also a Magento-side version in the Bling queue (`syncProductWithMagento`, reason `"Produto não encontrado no Magento"` — Magento, `src/modules/handlers/magentoV2/`, is cross-checked for price/mapping during the Bling flow). Resolution here is **mapping-only** (`resolveProductWithMapping`) — deliberately no EAN/SKU fallback, so an unresolved row here really has no local match, not just a lookup miss.
- **`invoice_id: <id>`** — created during invoice import when a line item couldn't resolve to a local `Product`. Two sub-cases now, distinguished by `type`, not just presence of `invoice_id`:
  - **`type: "ERROR_CATALOG"`** (Tecinco only, `ensureProductsFromInvoiceItems`) — the item's `integration_mapping` genuinely doesn't exist (reason `"Produto Tecinco presente na nota mas sem produto correspondente no banco"`). Resolution there is mapping-only too, same as the catalog flow — no `SupplierMapping`/código-de-fábrica fallback (removed entirely after a 2026-09 prod incident, see `../product/tecinco/catalog-preflight.md`). Because `systemId` is always known when this fires, `external_id` gets populated here too, unlike the historical invoice-row case below.
  - **`type: "ERROR_INVOICE"`** (default, Bling + Tecinco structural cases) — the failure isn't about catalog mapping: Bling's SKU/EAN-missing-from-the-API-item cases, or Tecinco's "`UnitBusiness` not found for this `branchId`" case. `external_id` stays unset here — there's no ERP product id to point to, either because the API item itself is incomplete (Bling) or because the failure happened before any per-item resolution could even run (Tecinco's `UnitBusiness` case).

**Dedup**: both flows check `existingUnmapped` by `sku` and/or `ean` scoped to the same `invoice_id`, and to `integrations_id` for the `invoice_id: null` case — because of unique index `unique_ean_integration_null_invoice` (`m266`, replaced the older global `unique_ean_null_invoice`): `UNIQUE(ean, integrations_id) WHERE invoice_id IS NULL`, scoped per integration so two integrations' catalogs can share an EAN without colliding. Within the same integration, two different SKUs sharing an EAN still collide on that index — dedup must check `ean` too, not just `sku`.

**`external_id`** (`m267`) was originally only populated on the `invoice_id: null` case — the ERP's own product id (Bling `produtoId` / Tecinco `epctb_codigo`). It's what lets `UnmappedInvoiceProductService.createProduct` create a real `Product` from a row (see the create-flow file) — that endpoint doesn't check `invoice_id`, only that `external_id` is set, so an invoice-linked Tecinco `ERROR_CATALOG` row can trigger create-product too now, same as a catalog row. Bling's invoice-linked rows still never get `external_id` (only a supplier code is known there) and stay `ERROR_INVOICE`.

When an item later resolves, the matching rows are cleaned up two ways: the per-invoice reconciliation loop ("Limpa UnmappedInvoiceProduct" step in `invoice-xml.ts`/`bling-api-fetch.queue.ts`, runs when that *same* invoice gets reprocessed) and, since this change, `UnmappedInvoiceProductService.resolveFromCreatedProduct` (runs when the *product* gets resolved/created from the catalog side) — the latter now closes **every** unmapped row sharing that `external_id`+`integrations_id`, catalog or invoice-linked, creating the missing `InvoiceItems` row first when needed (see `create-flow.md`). This means a Tecinco invoice unmapped by `ERROR_CATALOG` no longer needs that *same invoice* to be reprocessed, or a manual `/add/item` call, to get resolved — mapping the product anywhere (catalog sync, create-product) closes it automatically. `resolveFromCreatedProduct` takes an optional `excludeIds` to skip specific rows from this bare-bones closing — used by `createProductAndMapToInvoice` (see `create-flow.md`) to hand one specific row off to the richer manual-mapping flow instead.

**Upsert, not just dedup-check**: a catalog-sync pass (`fetchAndUpsertProduct`/`processProduct`/`syncProductWithMagento`) finding an existing unmapped row for the same `sku`/`ean` used to no-op — a bug for `external_id`, since rows created before `m267` (or from a pass that didn't resolve it yet) would never get it backfilled, permanently blocking create-product for them. Now every pass calls `.update({ sku, ean, external_id, product_name })` instead of no-op'ing. `status` is deliberately left untouched by this update (never forced back to `"UNMAPPED"`) — a row a human already resolved to `"MAPPED"` via `markMapped` doesn't get silently reverted by a later sync.

## `type` column (`m269`)

Categorizes *why* a row is unmapped, independent of `reason` (free text) and `integrations_id`:
- `ERROR_CATALOG` — no `integration_mapping` found. The only type eligible for create-product. Originally catalog-sync-only (`invoice_id: null`); now also used by Tecinco's `ensureProductsFromInvoiceItems` for invoice-linked rows (`invoice_id` set) when the failure is specifically "no mapping for this item" — see the `invoice_id: <id>` bullet above.
- `ERROR_INTEGRATION` — cross-check against a system that isn't the product's ERP of origin (e.g. `syncProductWithMagento`) — mapping-only, never creates a Product.
- `ERROR_INVOICE` — invoice-line item unresolved for a reason that isn't "no catalog mapping" (Bling's SKU/EAN-missing cases, Tecinco's `UnitBusiness`-not-found case). Default `type` in `invoice-xml.ts` when the caller doesn't specify one.
- `ERROR_SCAN` — manual EAN-photo lookup miss (`createUnmappedFromReadingEan`) — the only case with no `integrations_id` tie to a catalog/invoice flow.
- `ERROR_CATALOG_DUPLICATE` (`m271`, Tecinco-only) — a catalog code colliding with a different product elsewhere in the Tecinco catalog; see `../product/tecinco/catalog-preflight.md`. Deliberately inert — not eligible for create-product like `ERROR_CATALOG` is.

`filterableFields` also includes `type`, `integrations_id`, `reason`, `product_name`, `external_id`, `ean`, `sku` (exact-match, same mechanism as the pre-existing `status`/`invoice_id` filters) alongside the free-text `search` over `product_name`/`ean`/`sku`.

`m269`'s backfill needed an explicit `::"enum_unmapped_invoice_products_type"` cast (a bare `CASE` of string literals defaults to `text` in Postgres, rejected on assignment into an enum column) — and the migration had to be made idempotent (`describeTable` guard on `ADD COLUMN`, `WHERE type IS NULL` on the backfill) because sequelize-cli does **not** wrap a migration's `up()` in a transaction here, so the first failing run had already committed `ADD COLUMN` before erroring on the cast.

## Auth

Controller is in the HIGH unscoped-CRUD list — see `../../modules/auth.md`. Not fixed.
