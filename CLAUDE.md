# Architecture rules

## Layer separation: repository / service / controller

This codebase's modules follow the `BaseRepository` / `BaseService` / `BaseController`
pattern (see `src/shared/utils/base-models/`). Each layer only talks to its own
layer in other entities — never reaches past it:

- **Repository** talks only to its own Sequelize model. If it needs data from
  another entity and it's not a plain `include`, it must go through that
  other entity's **repository** — never call another entity's model
  directly from a repository.
- **Service** contains business rules and orchestration. If it needs another
  entity, it calls that entity's **service** (e.g. `productConfigService`,
  `supplierMappingService`) — never that entity's model or repository
  directly.
- **Controller** only handles request/response (params, auth context,
  status codes) and delegates to its own service.

`include` in a Sequelize query (eager-loading a relation as part of one
query) is fine at any layer that already queries its own model — that's not
"calling another entity," it's a join. But a *separate* query against another
entity's model (e.g. `ProductConfig.findOne(...)` or
`SupplierMapping.findOne(...)` from inside `ProductService`) is a layering
violation, even if the result is only read, never written.

**The `include` carve-out above applies to the repository layer only — not
to services.** Even within a single entity's own service, a query that
references another model — including a plain `include` used only for
eager-loading a related entity's fields — must not be written inline in the
service. That kind of query construction belongs in a named method on the
entity's own repository (e.g. `unmappedInvoiceProductRepository.findUnmappedByInvoiceIds(...)`,
`unmappedInvoiceProductRepository.findByCodeExcluding(...)`), and the
service only calls that repository method — it never builds the
`include`/`where` object itself. A service method that calls the inherited
`BaseService.findAll`/`findOne` with a plain `where` and no `include` (so it
never references another model at all) is still fine directly in the
service — the line is specifically about any query shape that names or
joins another model, not about using the base service's generic finders in
general. See `unmapped-invoice-product.repository.ts`'s `getFullById`,
`findUnmappedByInvoiceIds`, and `findByCodeExcluding` for the pattern: the
repository owns every `include`, and `unmapped-invoice-product.service.ts`'s
`findCascadeMatches` calls the repository method and only does the
CNPJ-normalization *filtering* (business logic, not query construction) on
the result in the service.

Before adding a method that needs another entity's data, check
`BaseRepository`/`BaseService`/`BaseController` first — most generic
lookups (`findOne`, `findById`, `findAll`, etc.) are already there, so the
correct fix is usually calling `<entity>Service.findOne(...)`, not writing a
new raw query.

# Domain context — module reference

This section is a working map of the modules below, built from direct code
reading across several sessions. It exists so a new session doesn't have to
re-read the whole system to get oriented. **Keep it updated**: whenever a
change in this conversation touches one of these modules in a way that
changes the facts below (a new field, a fixed/found tenant-scoping bug, a
changed resolution order, a new trigger/constraint), update the relevant
part of this section in the same turn — don't leave it to drift out of date.

## Tenant-scoping model (cross-cutting, read this first)

- `getUserContext(req)` (`src/shared/query/get-logged-user.ts`) — derives
  `{ userId, unitBusinessId }` from the authenticated user. This is the
  standard way a controller should derive tenant scope.
- `resolveIntegrationsIdForUnitBusiness(unitBusinessId, transaction?)` and
  `isProductOwnedByIntegration(product, integrationsId)`
  (`src/modules/handlers/tecinco/queues/helpers/product.helpers.ts`) —
  shared helpers used throughout for integration-level scoping.
- `BaseController`'s generic CRUD routes (`GET /`, `GET /:id`, `POST /`,
  `POST /bulk`, `PUT /:id`, `PUT /bulk`, `DELETE /:id`, `DELETE /bulk` — no
  PATCH route exists) run **completely unscoped** by tenant
  (`unit_business_id`/`integrations_id`) unless the subclass explicitly
  overrides the action. This is the root cause behind most tenant-leak bugs
  found in this codebase.
- `userPermissions` middleware (`src/middlewares/user-permissions.ts`) only
  checks role-based CRUD permission per entity type — it never does
  row-level/tenant scoping, so it does not mitigate the leak above.
- `BaseRepository.findById`/`.update`/`.delete` don't take a forced tenant
  where-clause — ownership must be checked manually (fetch, compare, 404 on
  mismatch) before calling them in a scoped `show`/`update`/`destroy`.
  `BaseService.paginate(params, extraOptions?, forcedWhere?)` — `forcedWhere`
  is the mechanism for scoping `index` by tenant without touching
  user-supplied filters.

### Known tenant-scoping status by controller

**Fixed:**
- `supplier-mapping.controller.ts` — all actions scope by `integrations_id`
  derived from the logged user; `show`/`update`/`destroy` verify ownership
  (404 on mismatch); `update`/`bulkUpdate` strip any client-supplied
  `integrations_id`.
- `product_config.controller.ts` — previously had **no auth at all** on any
  route; now has `authenticate` + `userPermissions` on all actions, same
  ownership-scoping pattern keyed on `unit_business_id`.
- `batch.repository.ts` (expedition) — `ProductConfig` include inside
  `batchInvoicesInclude` was missing `where: { unit_business_id }`, leaking
  another store's `sku`/`gtin`/`price` on `/api/batch/full/get`. Fixed.

**NOT fixed — CRITICAL (no auth at all):**
- `src/modules/inventory/stock/stock/stock.controller.ts` — no
  `middlewaresFor()`; any unauthenticated request can read/write/delete
  stock of any store.
- `src/modules/integrations/integration-mapping/integration-mapping.controller.ts`
  — `index`/`show`/`create`/`bulkCreate` have no `middlewaresFor()`
  (`update`/`destroy`/`bulkUpdate`/`bulkDestroy` always return 405, so those
  four are safe by being disabled, not by being scoped).

**NOT fixed — HIGH (authenticated, but not scoped by tenant):**
- `src/modules/integrations/config_tokens/config_tokens.controller.ts` —
  worst of this group: stores `access_token`/`refresh_token`/
  `client_secret`/`api_key` per `integrations_id`; any user with generic
  "config_tokens" role permission can read/overwrite any integration's
  credentials.
- `src/modules/warehouse/fiscal/invoices/invoice/invoice.controller.ts` —
  `show`/`destroy`/`create` unscoped; `index`/`update`/`getFullInvoice`
  accept a client-supplied `?unitBusinessId=` that overrides the logged
  user's own store; `getDanfeBatch`/`downloadXmlBatch` fetch by id list with
  no store filter (leaks DANFE/XML/CNPJ across stores).
- `src/modules/inventory/stock/stock-movements/stock-movements.controller.ts`
  — CRUD base unscoped, and custom endpoints (`getHistory`, `sync`,
  `createManualAdjustment`, etc.) trust a client-supplied
  `unit_business_id`.
- Same generic-CRUD-unscoped pattern in: `user.controller.ts`,
  `user_unit_business.controller.ts`, `unit-business-config.controller.ts`,
  `inventory-batch.controller.ts`, `unmapped-invoice-product.controller.ts`,
  `contacts.controller.ts`, `order_items.controller.ts`,
  `orders.controller.ts`, `batch.controller.ts` (expedition),
  `operation-comment.controller.ts`, `transporter.controller.ts`.

**LOW / possible false positive:**
- `unit-business.controller.ts` — `index`/`show` aren't scoped to the
  user's own store(s); `update`/`destroy` only check role. May be
  intentional (it's the tenant list itself) — needs a product decision, not
  an obvious bug fix.

## Products (`src/modules/inventory/products/`)

- `Product` is intentionally **not** tenant-scoped by itself — it's shared
  across integrations by design. Ownership/ambiguity is resolved through
  `ProductConfig` (per `unit_business_id`) and `SupplierMapping` (per
  `integrations_id`), not through the `Product` row.
- `ProductService.findProductByCode(code, unitBusinessId)` — read-only
  lookup used by `GET /by-code/:code`: normalizes the code, checks
  `ProductConfig.gtin` scoped to `unitBusinessId`, falls back to
  `supplierMappingService.findByProductCode(code, unitBusinessId)`.
- `ProductService.findByCode(code, unitBusinessId)` — older, similar method
  used by `scan-logs.service.ts`; returns `{ product, matchedCode }`.
- `create`/`update` on `Product` optionally manage a nested `ProductConfig`;
  before writing a `gtin`, they call
  `assertEanNotOwnedByAnotherProduct` (see helpers below) to pre-check
  conflicts with a clear error instead of a raw Postgres constraint error.
- Query config (`product.query-config.ts`, mirrored in `product.service.ts`):
  search/sort/filter by `name`, `ProductConfig.sku`, `ProductConfig.gtin`.
  **`gtin_package` was removed from all of this** (see below) — search,
  sort, and the `gtin` custom filter now only look at `ProductConfig.gtin`.
- Routes: `GET /:id/full`, `GET /by-code/:code` (read-only lookup),
  `GET /detailed/get`, `GET /report/get`, `GET /by-unit-business/get`,
  `GET /sales-report/get`.
- `products.id_system` has a **global** unique DB index
  (`products_id_system_key`, migration `20260415125537`/`20260415130053`) —
  unique across the whole table, not scoped by `integrations_id`. This
  matters for the create-product-from-unmapped flow (see below): before
  creating a `Product` for a given ERP id, callers must check whether a
  Product with that `id_system` already exists (even if `resolveProductWithMapping`
  found no valid mapping for it — i.e. an orphaned/missing-mapping case),
  otherwise `productService.create` throws a raw Postgres constraint error
  instead of a clear one.
- `products.category` (ENUM: `TIRE`, `PART`, `OIL`, `BATTERY`, `ACCESSORY`,
  `WHEEL`, `TUBE`, `SERVICE`, `OTHER`; default `TIRE`; DB column added by
  migration `20260609225551-add-product-category-and-unit-business-type.js`)
  existed in the database but was **missing from `product.model.ts`'s
  `.init()`** until this session — added now with the same enum/default.
  Before this fix, any code reading/writing `Product.category` through
  Sequelize silently ignored the column.

## ProductConfig (`src/modules/inventory/product-config/`)

- Per `(product_id, unit_business_id)` (unique): `sku`, `price`, `gtin`,
  `gtin_package`, `ncm`, `cest`, `supplier_cost_price`,
  `supplier_purchase_price`, average-cost fields.
- **`gtin_package` (EAN tributário/de embalagem, e.g. Bling's
  `gtinEmbalagem`)**: as of migration `m265`, this field is written but
  **no longer used anywhere** — not in matching/resolution, not in search,
  not in conflict validation. It exists purely for possible future use. Any
  new code should not read it for matching; only `gtin` is authoritative.
  This was a deliberate decision (see "gtin_package removal" below), not an
  oversight — don't "fix" it back to a fallback without checking with the
  user first.
- DB trigger `trigger_prevent_product_config_gtin_conflict` (created
  `m264`, narrowed in `m265`): blocks INSERT/UPDATE if `NEW.gtin` matches
  another product's `gtin` within the same `unit_business_id`. No longer
  touches `gtin_package` at all.

## SupplierMapping (`src/modules/inventory/supplier-mapping/`)

- Table `product_supplier_maps`: `product_id`, `supplier_cnpj`,
  `supplier_product_code`, `integrations_id`.
- Unique index `product_supplier_maps_integrations_id_code_unique
  (integrations_id, supplier_product_code)` (since `m263` — replaced an
  older `(product_id, supplier_product_code)` unique that didn't allow the
  same code to map to different products across different integrations,
  which is legitimate).
- DB trigger `trigger_prevent_supplier_mapping_gtin_conflict` (created
  `m263`, narrowed in `m265`): `supplier_product_code` cannot equal another
  product's `ProductConfig.gtin` within the same integration (joins
  `unit_businesses.integrations_id`). No longer checks `gtin_package`.
- `supplierMappingService.findByProductCode(code, unitBusinessId)` —
  resolves `integrations_id` for the unit business, then looks up the
  mapping; this is the method to reuse instead of duplicating a raw
  `findOne` with the same where-clause.
- `supplierMappingService.createFromUnmapped({ productId, unmappedInvoiceProductId, supplierCnpj? })`
  (this session) — manually maps an `UnmappedInvoiceProduct` to an
  **already-existing** `Product` via `SupplierMapping`, without going
  through `InvoiceItems` at all. Exposed at `POST /supplier-mapping/from-unmapped`.
  Mainly for **catalog-scoped** unmapped rows (`invoice_id: null`), where
  `InvoiceItemsService.createInvoiceItemForUnmappedProducts` doesn't apply
  (there's no invoice to attach an item to). Behavior:
  - Code = `unmapped.ean ?? unmapped.sku`; `integrations_id` comes from the
    unmapped row itself.
  - **Idempotent when the mapping already exists for the same product**:
    if a `SupplierMapping` already exists for `(integrations_id, code)` and
    it already points at the *same* `product_id` being sent, this is
    treated as success (no re-insert attempt, avoids hitting the unique
    constraint pointlessly) — it still proceeds to the mapping/delete steps
    below. Only throws when the existing mapping points at a **different**
    product (a real conflict).
  - If the unmapped row has `external_id` set (i.e. it's catalog-scoped,
    the ERP's own product id is known), also calls
    `integrationMappingService.createOrUpdateIntegrationMapping(...)` for
    that `(entity_type: "PRODUCT", internal_id: productId, integrations_id, external_id)`
    — without this, the next Bling/Tecinco catalog sync wouldn't find a
    mapping for that `external_id` and would recreate the same unmapped row,
    undoing the manual mapping just made.
  - Deletes the `UnmappedInvoiceProduct` row at the end. All of the above
    runs in one transaction.
  - The controller checks `unmapped.integrations_id` against the logged
    user's own resolved integration before calling the service (same
    ownership-check pattern as `show`/`update`/`destroy` in this
    controller) — a user can't map an unmapped row belonging to a different
    integration/tenant this way.

## Integration mapping (`src/modules/integrations/integration-mapping/`)

- Table `integration_mappings`: `entity_type` (e.g. `"PRODUCT"`,
  `"CONTACT"`), `internal_id`, `integrations_id`, `external_id` — maps a
  local entity to its id in an external system (Bling/Tecinco).
- `integrationMappingService.findGroupedMappingsMap(...)` /
  `.findExternalIdsMap(...)` — used to enrich rows (e.g. in
  `order_items.service.ts`) with external integration ids in bulk.
- `integrationMappingService.createOrUpdateIntegrationMapping(...)` —
  despite the name, **never actually updates/reassigns an existing
  mapping**: if a row already exists for `(entity_type, integrations_id,
  internal_id OR external_id)`, it just `console.warn`s and returns the
  existing row unchanged, no exception raised. `Product` deletion does
  **not** clean up its `integration_mappings` rows (no FK — `internal_id`
  is a plain varchar, not a real foreign key) — so manually deleting a
  Product that already had a mapping leaves an **orphaned mapping** behind,
  permanently squatting that `external_id`. The next time that same
  external product needs a *new* local Product created for it (e.g. via
  `UnmappedInvoiceProductService.createProduct` → Bling's
  `createProductFromBlingData` / Tecinco's `createProductFromTCarData`,
  both of which call `createOrUpdateIntegrationMapping` right after
  creating the product), the create-product flow finishes "successfully"
  (Product + ProductConfig do get created) but the mapping step silently
  no-ops against the stale orphan — the new product ends up with **no**
  `integration_mapping` at all, and nothing in the response/logs surfaces
  this beyond a `console.warn`. Confirmed and reproduced this session
  (product manually deleted → its `external_id`'s mapping orphaned → next
  product created for that same `external_id` got no mapping). **Fixed**
  (`m268-delete-integration-mapping-on-product-delete.js`, this session):
  DB trigger `trigger_delete_integration_mapping_on_product_delete`
  (`AFTER DELETE ON products`) deletes any `integration_mappings` row with
  `entity_type = 'PRODUCT'` and `internal_id = <deleted product's id>`.
  Only touches `entity_type = 'PRODUCT'` — other entity types (e.g.
  `CONTACT`) are unaffected by Product deletion. This closes the orphan at
  its source going forward, but `createOrUpdateIntegrationMapping`'s
  silent-no-op-on-conflict behavior itself is unchanged — any orphan rows
  that already existed before this migration are not backfilled/cleaned up
  by it.
- **Controller has a CRITICAL auth gap — see scoping status above. Not
  fixed.**

## Unmapped invoice products (`src/modules/inventory/unmapped-invoice-product/`)

- Despite the name, this is a general "needs manual mapping" review queue,
  **not only** for invoice line items. `UnmappedInvoiceProduct` rows are
  created from two different flows, distinguished by `invoice_id`:
  - **`invoice_id: null`** — created during an integration's *product
    catalog* fetch/sync (not from an invoice), when the fetched product has
    no corresponding local `integration_mapping` yet. Happens in both
    `bling-api-fetch.queue.ts` (`fetchAndUpsertProduct`, reason `"Produto
    novo, precisa de mapeamento manual"`) and
    `tecinco-api-fetch.queue.ts` (same reason). There's also a Magento-side
    version of this in the Bling queue (`syncProductWithMagento`, reason
    `"Produto não encontrado no Magento"`) — Magento is a third integration
    (`src/modules/handlers/magentoV2/`) cross-checked for price/mapping
    during the Bling flow. Product resolution for this case is **mapping-only**
    (`resolveProductWithMapping`) — deliberately no EAN/SKU fallback, so an
    unresolved product here really has no local match yet, not just a
    lookup miss.
  - **`invoice_id: <id>`** — created during invoice import when a line item
    on a real NF-e/note couldn't be resolved to a local `Product` (reason
    e.g. `"Produto Tecinco presente na nota mas sem produto correspondente
    no banco"`). This is the original/narrower case.
  - Both flows dedupe before creating (`existingUnmapped` lookup by `sku`
    and/or `ean` scoped to the same `invoice_id` value, and to
    `integrations_id` for the `invoice_id: null` case) because of the
    unique index `unique_ean_integration_null_invoice` (`m266`, replaced
    the older global `unique_ean_null_invoice`) — `UNIQUE(ean,
    integrations_id) WHERE invoice_id IS NULL` — scoped per integration so
    two different integrations' catalogs can legitimately share an EAN
    without colliding; within the same integration, two different SKUs
    sharing the same EAN still collide on that index, so dedup must check
    `ean` too, not just `sku`.
  - `external_id` (`m267`) is only populated on the `invoice_id: null`
    (catalog-fetch) case — it's the ERP's own product id (Bling
    `produtoId` / Tecinco `epctb_codigo`), never available on the
    invoice-import case where only a supplier code is known. It's what
    lets `UnmappedInvoiceProductService.createProduct` create a real
    `Product` from an unmapped row.
  - When an item later resolves, the matching `UnmappedInvoiceProduct` rows
    are cleaned up (see the "Limpa UnmappedInvoiceProduct" step in
    `bling-api-fetch.queue.ts`).
  - **Upsert, not just dedup-check** (this session): when a catalog-sync
    pass (`fetchAndUpsertProduct`/`processProduct`/`syncProductWithMagento`)
    finds an unmapped row already exists for the same `sku`/`ean`, it used
    to do nothing — a real bug for `external_id`, since rows created
    *before* the `m267` column existed (or from a pass where it wasn't
    resolved yet) would never get it backfilled, permanently blocking
    create-product for them. Now every pass calls `.update({ sku, ean,
    external_id, product_name })` on the existing row instead of no-op'ing.
    `status` is deliberately left untouched by this update (never forced
    back to `"UNMAPPED"`), so a row a human already resolved to `"MAPPED"`
    via `markMapped` doesn't get silently reverted by a later sync pass.
- **Controller is in the HIGH unscoped-CRUD list above. Not fixed.**

### Create product from unmapped (this session)

Lets a user manually turn a catalog-scoped `UnmappedInvoiceProduct`
(`invoice_id: null`, `external_id` populated) into a real `Product`,
reusing the existing Bling/Tecinco fetch-and-upsert pipeline instead of
duplicating its logic (KIT handling, Magento sync, kardex, per-filial
stock — all of that already works generically once a `Product` exists, so
the new code only needs to *produce* one and fall through). **This is
always user-triggered — there is no automatic trigger anywhere else**; the
normal catalog-sync path still only registers unmapped rows unless this
flag is explicitly set.

- Endpoint: `POST /unmapped-invoice-products/:id/create-product` — validates
  `external_id` is set, resolves the integration (`Bling`/`Tecinco`) from
  `unmapped.integrations_id`, and enqueues a job on the **same existing**
  `BlingApiFetchQueue`/`TCarUpsertQueue` (no dedicated queue was created).
  For Tecinco, resolves the user's branch via
  `src/shared/utils/tecinco/resolve-branch-id.ts`'s `resolveTecincoBranchId`
  (shared with `InvoiceService.importInvoiceXml`, extracted this session)
  and enqueues a **minimal** payload (`fll_codigo`, `epctb_codigo`,
  `epctb_nome` placeholder) — the worker itself fetches the full ERP detail
  (see below), not the HTTP request.
- **Priority mechanism — reuses existing queue infra, no new queue/lock**:
  `BaseQueueService.add(data, jobId, jobOptions)` gained an optional
  `jobOptions.priority` forwarded straight to BullMQ's native per-job
  `priority` (lower number = picked first; jobs without an explicit
  priority always sort after any job that has one). The create-product job
  is enqueued with `priority: 1` on the *same* `BLING_API_FETCH`/
  `TCAR_UPSERT` queue used for normal sync — no new queue class, no change
  to `BLING_SHARED_QUEUE_LOCK`'s ranks, no equivalent lock added for
  Tecinco. This was a deliberate simplification after an earlier design
  (separate `BLING_PRODUCT_CREATE`/`TECINCO_PRODUCT_CREATE` queues with
  their own lock wiring) was rejected as unnecessary infra. Caveat: BullMQ
  cannot preempt a job already *running* — `priority` only affects which
  job is picked up *next*.
- `fetchAndUpsertProduct` (Bling) / `processProduct` (Tecinco) both gained
  an `opts.create` flag (default `false`, preserves prior behavior). When
  `resolveProductWithMapping` finds nothing and `opts.create` is true
  (or, **for Bling only**, when the product is a KIT — see below), instead
  of registering an unmapped row and returning, they call a new private
  `createProductFromBlingData`/`createProductFromTCarData` which:
  1. Checks `Product.findOne({ where: { id_system } })` for a pre-existing
     Product with that exact `id_system` (see the global-uniqueness note in
     the Products section above) — if found, this means a mapping is
     missing/orphaned for an existing product; it does **not** silently
     reconnect to it (a prior bug class: resolving by `id_system` directly
     already caused the wrong product being picked when an `id_system` was
     reused externally without the mapping following along — see
     `resolveProductByMappingOnly`'s own comment in `product.helpers.ts`).
     It throws a `bullmq` `UnrecoverableError` with a friendly
     lead sentence + the product names + technical ids bracketed at the
     end, asking for manual investigation.
  2. Otherwise calls `productService.create(...)` (wrapped in try/catch,
     any failure — EAN conflict, DB constraint — also rethrown as
     `UnrecoverableError`, since it's about already-resolved data and
     deterministic: retrying with the same input fails the same way) and
     `integrationMappingService.createOrUpdateIntegrationMapping(...)`.
  3. Calls `unmappedInvoiceProductService.resolveFromCreatedProduct({ externalId, integrationsId })`
     — finds the *specific* originating catalog unmapped row (by
     `external_id` + `integrations_id`) and **just deletes it**. This does
     **not** create an `InvoiceItems` row, does **not** cascade to sibling
     unmapped rows in other invoices, and does **not** touch any other
     unmapped row sharing the same EAN/SKU. Resolving *other* invoices that
     had the same product unmapped is left entirely to the separate manual
     flow (`POST /add/item` → `createInvoiceItemForUnmappedProducts`, see
     the Invoices/fiscal section's cascade entry) — deliberately, since an
     EAN shared across different suppliers' invoices isn't guaranteed to be
     the same physical product.
  4. Returns the new/existing product, and the caller falls through into
     the rest of `fetchAndUpsertProduct`/`processProduct` exactly as if
     the product had been found by mapping (KIT component sync, Magento
     sync, `ProductConfig`/`Stock` upsert, kardex) — no duplicated logic.
- **KIT auto-create (Bling only, no `opts.create` needed)**: a product with
  `blingProduct.formato === "E"` always takes the create branch even
  without the manual endpoint, because a KIT's `ProductConfig.sku` is
  synthesized from its resolved component's sku + quantity
  (`${componentSku}K${quantidade}`) — that code is inherently unique to
  that exact component combination, so there is no risk of the "this code
  might belong to a different product" ambiguity that justifies requiring
  manual confirmation for regular products. Tecinco has no equivalent — it
  never syncs KIT composition at all (Tecinco-owned catalog data has no KIT
  concept; the Bling `formato === "E"` check simply never matches there).
- **Job status polling**: `GET /unmapped-invoice-products/:id/create-product/job`
  → `UnmappedInvoiceProductService.getCreateProductJobStatus` looks up the
  job by its deterministic id (`bling-product-create-${id}` /
  `tecinco-product-create-${id}`, tried against both queues) and maps
  BullMQ's `job.getState()` to `{ status, error? }`. Two BullMQ-specific
  gotchas this had to account for:
  - A job enqueued with an explicit `priority` sits in BullMQ's separate
    `"prioritized"` state (not `"waiting"`) until a worker picks it up —
    reported to the caller as `"waiting"` (the frontend has no reason to
    care about the distinction).
  - Queue jobs default to `removeOnComplete: true` (instant deletion on
    success — fine for high-volume sync queues, which is why it's still
    the `BaseQueueService.add` default), so a *successfully finished*
    create-product job would vanish before anyone could poll it and this
    endpoint would wrongly report `"not_found"` instead of `"completed"`.
    `BaseQueueService.add` now accepts a per-call `jobOptions.removeOnComplete`
    override; the create-product job passes `{ age: 24 * 3600 }` (keeps it
    24h after finishing) — every *other* caller of `.add()` keeps the
    instant-delete default.
  - Permanent failures use `UnrecoverableError` specifically so `getState()`
    reports `"failed"` immediately — the queue's normal `attempts: 5`
    exponential backoff (~30s/60s/120s/240s/480s, ~15min total) is
    otherwise still the default and would leave `getState()` reporting
    `"delayed"` for that whole window even for an error that's certain to
    fail identically on every retry.
- **Error-message convention adopted this session** for anything that can
  reach an end user through this flow (job `failedReason`, thrown
  `Error`/`UnrecoverableError` messages): lead with one plain-language
  sentence a non-technical user can act on (what happened, and — for
  data-inconsistency cases — "encaminhe este erro para o time técnico"),
  name the actual product(s) involved by `name` (not just id), and put the
  technical detail (ids, field names, code file/function) in `[...]` at the
  end for whoever the message gets forwarded to. See
  `assertEanNotOwnedByAnotherProduct`'s `EanConflictError` message and the
  `id_system`-conflict messages in `createProductFromBlingData`/
  `createProductFromTCarData` for the concrete pattern.

## Invoices / fiscal (`src/modules/warehouse/fiscal/invoices/`)

- `invoice/` — `Invoice` model/service/repository/controller, plus
  `invoice-label.service.ts` (resolves EAN for printed labels) and
  `helpers/totals.ts` (`totalExpectedLiteral`/`totalReadLiteral`).
- `invoice-items/` — `InvoiceItems` + `InvoiceFiscalItem`; resolves the
  product/config for each line using the standard priority order below.
- **Manual mapping cascade** (`POST /add/item` →
  `InvoiceItemsService.createInvoiceItemForUnmappedProductsInTx`): mapping
  one `UnmappedInvoiceProduct` manually also auto-maps "sibling" unmapped
  rows in *other* invoices that share the same supplier code + sender CNPJ
  (`cascadeAutoMapUnmapped`/`findCascadeMatches`). `cascadeAutoMapUnmapped`
  only ever runs **once per request**, from the root call — it fetches all
  siblings in a single query and processes each one via
  `createInvoiceItemForUnmappedProductsInTx(..., triggerCascade: false)`,
  which skips re-triggering the cascade. `triggerCascade` defaults to
  `true` and must stay `true` only on the root (user-initiated) call.
  This was fixed this session from a self-recursive design (every sibling
  processed used to re-run `cascadeAutoMapUnmapped` itself) that had a real
  bug: since the outer loop's match list was captured once up front, a
  sibling further down it could already have been consumed by an inner
  recursive call triggered by an earlier sibling, and the outer loop's
  stale second attempt threw `"Produto não mapeado não encontrado!"` on the
  already-deleted row — rolling back the whole transaction (one shared
  transaction for the whole cascade), undoing siblings that had already
  mapped successfully. If this function is touched again, keep
  `cascadeAutoMapUnmapped` single-shot (`triggerCascade: false` on every
  call it makes) rather than reintroducing recursion.
- **Standard product-resolution order** used across the Bling queue, NF-e
  XML import, and maintenance scripts: SKU (`ProductConfig.sku`) first →
  `ProductConfig.gtin` → `SupplierMapping` by code + integration. SKU wins
  when it matches; EAN/gtin is only a fallback when there's no SKU match.
  `gtin_package` does **not** participate in this order (removed in
  `m265`).
- `src/shared/utils/xml/invoice-xml.ts` — parses NF-e XML and resolves the
  product per item using that same order.
  - **Raw-XML unmapped fallback removed (this session)**: when the calling
    integration provides *no* item info at all for an invoice (neither
    `operationalItems` nor `unmappedItems` — tracked by the
    `willFallbackToXmlDet` flag), the code used to fall back to parsing the
    raw XML `<det>` nodes and create an `UnmappedInvoiceProduct` per line
    with a generic reason (`"Integração não retornou itens da API..."`).
    This produced unmapped rows for lines with no way to know whether they
    were even a tracked product category (a real example hit: an engine
    oil line got flagged this way even though only tire-category invoices
    should reach this reconciliation at all) — `cProd` in that fallback is
    the *supplier's* code, never resolves a `Product`, and there's no
    signal available at that point to filter by category. Now, when
    `willFallbackToXmlDet` is true, the **entire invoice is ignored** for
    unmapped-reconciliation purposes this pass: no unmapped rows are
    created, and — just as importantly — the existing "delete stale
    `UNMAPPED` rows no longer present in this pass" reconciliation loop is
    also skipped entirely, so nothing already recorded for that invoice
    gets touched either. The invoice itself still gets created/updated
    normally with whatever real items *were* resolved; only the
    unmapped-tracking side is skipped.
- FK behavior on deleting an `invoices` row: `stock_movements.invoice_id`
  and `orders.invoice_id` are `RESTRICT` (block deletion);
  `operations.invoice_id` and `sales_order_snapshots.invoice_id` are
  `SET NULL`; `expedition_batch_invoices`, `invoice_fiscal_items`,
  `invoice_items`, `invoice_logistic_occurrences`,
  `invoice_operation_snapshots`, `invoice_unit_business_attributes`,
  `unmapped_invoice_products` are `CASCADE`.
- **`invoice.controller.ts` has HIGH-severity scoping gaps — see status
  above. Not fixed**: `show`/`destroy`/`create` unscoped; other actions
  trust a client-supplied `?unitBusinessId=` over the logged user's own;
  DANFE/XML batch downloads have no store filter.

## Stock / stock movements (`src/modules/inventory/stock/`)

- `stock_movements` columns: `movement_type`, `direction`, `status`,
  `movement_quantity`, `balance_quantity`, `resulting_average_cost`,
  `unit_business_id`, `product_id`, `invoice_number`, `movement_date`.
  Anchor/correlation columns reference `invoice_number`, not a row id,
  because rows get hard-deleted and recreated.
  Has trigger `trigger_prevent_delete_manual_adjustment_with_cost`
  (BEFORE DELETE) that can block deleting a manual cost-adjustment
  movement.
- **`stock.controller.ts` has no auth at all (CRITICAL). `stock-movements.controller.ts`
  is unscoped by tenant (HIGH). Neither is fixed.**

## Expedition batches (`src/modules/warehouse/expedition/`)

- `batch/batch.repository.ts` — `getFullBatch`/`getFullBatches` build a
  nested include (invoice, batchInvoices, items → product →
  productConfigs/stocks), all scoped by the batch's own
  `unit_business_id` via `buildFullIncludes(unitBusinessId)`. The
  `ProductConfig` include cross-store leak here was found and fixed this
  session — any future change to this include must keep the
  `where: { unit_business_id }` on both the `ProductConfig` and `Stock`
  sub-includes.
- `scan-logs/scan-logs.service.ts` — matches a scanned physical label
  against `ProductConfig.gtin` (stripped of leading zeros too) OR the
  already-resolved `matchedCode` (SKU/mapping code). `gtin_package`
  matching was removed in `m265`.
- **`batch.controller.ts` (expedition) is in the HIGH unscoped-CRUD list.
  Not fixed.**
- **Blocked: adding an invoice with unmapped products to a batch (this
  session)**. Both `ExpeditionBatchService.generateBatchFromInvoices` and
  `.addInvoiceToBatch` now call
  `unmappedInvoiceProductService.findUnmappedByInvoiceIds(invoiceIds, t)`
  (query lives in `UnmappedInvoiceProductRepository`, per the
  repository-owns-queries rule above) and throw
  `"Nota(s) com produtos não mapeados: <numbers>"` before doing anything
  else if any targeted invoice still has `UnmappedInvoiceProduct` rows with
  `status: "UNMAPPED"`. In `generateBatchFromInvoices` this is scoped to
  `notBatched` (the invoices actually about to be processed this call, not
  ones already batched) and sits right before the existing
  `assertTransshipment` loop.

## Sales / orders (`src/modules/sales/orders/`)

- `order_items.service.ts` — builds sales-detail rows joining
  `ProductConfig` (by `gtin` only, since `m265`) with integration-mapping
  data and seller external ids; feeds Tecinco-facing reporting.
- **`orders.controller.ts` and `order_items.controller.ts` are in the HIGH
  unscoped-CRUD list. Not fixed.**

## Reports

- `sales-report.repository.ts` — raw SQL building the daily sales-report
  snapshot. Per the snapshot-is-source-of-truth pattern, values are
  computed once in `upsertSnapshots` and read from the snapshot table by
  everyone else. `gtin` column reads `pc.gtin` directly (no `gtin_package`
  fallback, since `m265`).

## `gtin_package` removal (migration `m265`, this session)

The `gtin_package` field on `ProductConfig` used to be used as a fallback
match alongside `gtin` in ~15 places (Bling sync, Tecinco resolution, NF-e
XML import, warehouse label scanning, order/report EAN display, DB
conflict triggers). This was intentionally removed at the user's request:
the same code could legitimately be one product's commercial `gtin` and a
different product's `gtin_package` (tributary/package EAN), and the DB
triggers were treating that as a conflict and blocking valid writes. Now:
- `gtin_package` is still a real column, still written (e.g. Bling's
  `gtinEmbalagem`), but is not read for any matching/resolution/search/sort
  logic anywhere in the app, and is not validated by any trigger.
- The only remaining reads of `gtin_package` are pure passthrough/export
  (e.g. `inventory-batch-logs.service.ts`'s `ean_tribut` output field, the
  `invoice.repository.ts` attributes list, `dump-local-products.ts`) — not
  resolution logic. That's intentional; leave those as-is.
- Migration `m265-drop-gtin-package-conflict-checks.js` narrows both
  `prevent_product_config_gtin_conflict` (`m264`) and
  `prevent_supplier_mapping_gtin_conflict` (`m263`) to only check `gtin`.
  As with every other migration in this repo, **the user runs migrations
  themselves — never run `db:migrate` (or any other migration/DDL command)
  automatically.**
