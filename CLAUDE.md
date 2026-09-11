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

## Code comments

Comments on code and functions must be brief, short, summarized, and
direct — no long paragraphs. State the one non-obvious reason (a hidden
constraint, a workaround, why this and not the obvious alternative) in a
line or two, not a multi-line explanation of what the code already says.

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
- **`products.id_system` was removed entirely this session** (migration
  `m275-remove-id-system-from-products.js`, both unique indexes
  `products_id_system_key`/`products_id_system_unique_idx` dropped along
  with the column). It used to be a legacy varchar holding "the last
  external id seen for this product," **globally unique** across the
  whole table — the root cause of a real production crash (see the
  `Product.id_system` history entry below, kept for context even though
  the field is gone): a physical product can legitimately have more than
  one external id mapped to it (`integration_mappings` handles this fine,
  scoped per integration; a single global-unique column can't). Every
  place that used to read `id_system` to resolve a product now goes
  through `integrationMappingService.findEntityByMapping("PRODUCT",
  integrationsId, externalId)` instead: Bling's `resolveKitComponent` (KIT
  component lookup), `bling-direct-upsert.queue.ts`'s
  `upsertSupplierMapping`, `bling-order.service.ts`'s
  `resolveProductWithConfig` (order-item cost resolution), and the
  physical-stock-lookup fallback in `bling-api-fetch.queue.ts` (which
  simply lost its `?? p.id_system` fallback — every product relevant to
  that path already got an `integration_mapping` backfilled first, see
  next point). `fetchAndUpsertProductSupplier` (Bling) was deleted outright
  as dead code — its only caller was already commented out. The
  create-time "does a Product already exist with this id" duplicate guard
  (both integrations' `createProductFromBlingData`/`createProductFromTCarData`)
  is also gone — there's nothing left to check it against; creation now
  relies entirely on `resolveProductWithMapping` + the EAN/SKU conflict
  handling documented elsewhere in this file.
  The backfill (create the `integration_mapping` for any `Product` that
  was until then only resolvable via `id_system`) is a standalone raw SQL
  statement (`INSERT INTO integration_mappings ... SELECT ... FROM
  products WHERE id_system IS NOT NULL ... ON CONFLICT (entity_type,
  integrations_id, external_id) DO NOTHING` — idempotent, safe to rerun),
  run by hand against prod **before** `m275`. Deliberately **not** embedded
  in the migration itself — considered and reverted; kept as a separate
  manual step instead. As always, **the user runs both the backfill SQL
  and the migration themselves.**
- `products.category` (ENUM: `TIRE`, `PART`, `OIL`, `BATTERY`, `ACCESSORY`,
  `WHEEL`, `TUBE`, `SERVICE`, `OTHER`; default `TIRE`; DB column added by
  migration `20260609225551-add-product-category-and-unit-business-type.js`)
  existed in the database but was **missing from `product.model.ts`'s
  `.init()`** until this session — added now with the same enum/default.
  Before this fix, any code reading/writing `Product.category` through
  Sequelize silently ignored the column.
- FK behavior on deleting a `products` row: `product_supplier_maps.product_id`,
  `stocks.product_id`, `product_configs.product_id`, and
  `kit_components.product_id` (the KIT/parent side) are `CASCADE`;
  `invoice_fiscal_items.product_id` is `SET NULL`; `invoice_items.product_id`,
  `stock_movements.product_id` (`m194`), `expedition_batch_items.product_id`,
  `inventory_batch_items.product_id`, and `kit_components.product_component_id`
  (the component side) are `RESTRICT` — deleting a `Product` that still has
  any of those rows pointing at it fails with a raw Postgres FK violation
  unless the dependent rows are deleted first. No code path in the app
  actually hard-deletes a `Product` today — `handleDeactivatedBlingProduct`
  (below) used to, but was reverted in favor of never deleting `Product`
  at all (see that section for why); these FK facts remain here because
  they're still relevant to any future/manual deletion.

### Auto-map by SKU/SupplierMapping across integrations, + Tecinco catalog-duplicate safety net (this session)

**Historical context, read this first if touching this again**: mid-session,
this cascade was found in production to cross-map completely unrelated
physical products — Tecinco reuses/duplicates numeric codes
(`epctb_codigofabrica`/`epctb_coded`/`epctb_ean`) across catalog entries
that have nothing to do with each other (confirmed real examples: a
`12-16.5` industrial skid-steer tire and a `265/60R18` Bridgestone Dueler
ended up sharing one `Product`, both via `sku=48681`; a `275/45R20`
Speedmax and a `275/40R21` Speedmax ditto). A first fix attempt removed
SKU/código-de-fábrica matching entirely (EAN-only), but the user reverted
that for **Bling** (collisions are rare there, not worth the lost recall)
and asked for a different fix on **Tecinco**, where the problem is real: a
**pre-enqueue safety net** that catches the ambiguous codes *before* they
ever reach the matching cascade, rather than removing the cascade's
trust in SKU altogether. So: the matching cascade itself is back to
exactly what it always was; what's new is the Tecinco-only pre-flight
step described below that keeps ambiguous codes from ever reaching it.

**Cascade in Bling's `fetchAndUpsertProduct` and Tecinco's `processProduct`**
(unchanged behavior, back to how it always worked), before registering an
unmapped row or creating a new `Product` for a code with no
`integration_mapping` yet — 2-level fallback via `autoMapExistingProductBySku`
in both `bling-api-fetch.queue.ts` and `tecinco-api-fetch.queue.ts`:
1. `integration_mapping` (`resolveProductWithMapping`).
2. `resolveProductBySku(sku, logPrefix)` (`product.helpers.ts`) —
   `ProductConfig.findOne({where: {sku}})`, **global**, not scoped by
   `unit_business_id`/`integrations_id` (the same physical product may have
   been created by the *other* integration first — catalog sync happens
   independently per integration). Bling passes `blingProduct.codigo`,
   Tecinco passes `epctb_codigofabrica` ("código de fábrica").
3. `resolveProductBySupplierMapping(code, integrationsId, logPrefix)` — same
   code, but via `SupplierMapping.supplier_product_code`, scoped to the
   syncing integration (`SupplierMapping` is inherently per-integration).

Either match auto-maps to the existing product (creates the
`integration_mappings` row, calls
`unmappedInvoiceProductService.resolveFromCreatedProduct(...)`) instead of
creating a duplicate `Product`; runs before the `opts.create`/unmapped
branch so even the manual create-product endpoint tries this first. KIT
(Bling only, `formato === "E"`) never calls this — its `ProductConfig.sku`
is synthesized, never expected to collide. Tecinco's `ensureProductsFromInvoiceItems`
gets the same 2-level fallback (minus the mapping upsert — that stays
catalog-sync-only). `ensureSupplierMappings` (`product.helpers.ts`) creates
a `SupplierMapping` row for whichever of `ean`/`codigoFabrica`/`systemId`
are present and not yet registered — all three, not EAN-only.

**New this session — Tecinco catalog-duplicate safety net**, since Tecinco
(unlike Bling) genuinely has codes that collide across unrelated products:
before `migrateProdutos` (`src/scripts/tecinco/tecinco-migration.runner.ts`,
called by both the full-migration script and `TCarSyncQueue`'s incremental
sync — same `runMigration` entry point either way) enqueues *anything* onto
`processProduct`, it now does a pre-flight pass:
1. Fetches the Tecinco catalog **in full** — every tire group
  (`tecincoTireGrupoIds`), ignoring both this run's `grupos` filter and
  `alteradoDesde` (a collision can involve a product outside this run's own
  batch, so a partial fetch can't be trusted) — via `fetchTecincoCatalog`
  (extracted from `dump-tecinco-catalog.ts`'s `main()`, now shared by both;
  that script's own `main()` is guarded by `require.main === module` so
  importing the module elsewhere doesn't trigger it). Still scoped to this
  run's `branchIds` (not `tecincoUnitBusinessForPopulate`'s full branch
  list) — a collision only matters for branches actually being synced.
2. Writes that catalog to `CATALOG_OUTPUT_PATH` (same path the standalone
   dump script uses) purely as an intermediate artifact — deletes it right
   after building the in-memory index, and *also* deletes any pre-existing
   file at that path before starting (defensive, in case a previous run
   crashed mid-way and left one behind). No dump JSON should ever survive
   a `migrateProdutos` run on disk. **Known gap, not addressed**: if two
   `migrateProdutos` runs ever executed concurrently, they'd race on this
   same file path — considered unlikely in practice (queue concurrency)
   and not worth a unique-per-run filename unless it's actually seen.
3. Builds 2 `Set<string>` (via `buildTecincoDuplicateValueSets`, in
   `tecinco-migration.runner.ts`) of **values** — not product ids — that
   appear on more than one catalog entry: one for `sku` (the code used to
   *find* a product — `epctb_codigofabrica`, falling back to `epctb_coded`
   only when there's no código de fábrica at all — see `effectiveSku`) and
   one for `ean`. `epctb_coded` was originally its own third independent
   axis but was collapsed into the `sku` axis this session — código de
   fábrica is what the matching cascade above actually reads, so that's
   what "duplicated" needs to mean here too; `epctb_coded` only still
   matters as a fallback signal when a catalog entry has no código de
   fábrica at all. A value repeated 2× or 200× is equally unsafe to
   auto-map on — no "too common to be a real collision" exemption; that
   reasoning is exactly backwards (the more a code repeats, the more
   products it could wrongly match). Empty/null values, and EAN's "sem
   GTIN" placeholder variants (via the existing `normalizeEan`), are never
   counted — genuinely confirmed against a real prod catalog dump this
   session that non-EAN placeholder-like codes (e.g. `sku=48681` repeated
   64×) are exactly the dangerous case, not noise to filter out.
4. Batch-checks which `external_id`s already have a **valid** (non-orphaned)
   `integration_mapping` — `internal_id` pointing at a `Product` that
   actually exists, same "não existe no sistema" criterion used to find the
   21 orphaned mappings earlier this session — via the new
   `integrationMappingService.findValidExternalIdsSet(integrationsId)`
   (`integration-mapping.service.ts`; queries its own model with a plain
   `where`, then calls `productService.findAll` to check existence — two
   services, no cross-model query in either repository, per the layering
   rule above).
5. **Revised later this session — `migrateProdutos` now always enqueues
   every catalog item, never skips one for being duplicated.** The earlier
   design (still described by an outdated version of this doc until now)
   had step 5 skip `enqueue()` entirely for a colliding item and write
   `registerCatalogDuplicate` instead — that function and that skip no
   longer exist. Now: for every item, `findTecincoCollidingFields` is
   computed unconditionally (cheap — just `Set` lookups against the index
   from step 3) and the result becomes two booleans,
   `skuDuplicated`/`eanDuplicated`, attached straight onto the job payload
   (`TCarUpsertJobPayload.skuDuplicated`/`.eanDuplicated`); the item is
   **always** enqueued onto `processProduct` regardless. The decision of
   what to do with a colliding code moved from "here, before enqueueing"
   to "inside `processProduct` itself" (see next point) — this was a
   deliberate simplification: `migrateProdutos` no longer needs its own
   parallel "is this externally mapped already" special-case (the old
   `validExternalIds` gate that decided whether to even run the duplicate
   check), since `processProduct` already knows how to handle an
   already-mapped product safely regardless of the flags.
6. **`processProduct` (`tecinco-api-fetch.queue.ts`) is where the flags
   actually take effect**, via `opts.skuDuplicated`/`opts.eanDuplicated`
   (both plumbed through `TCarUpsertQueue.process`'s job-data → opts
   mapping) and a derived `isDuplicatedInCatalog = skuDuplicated ||
   eanDuplicated`:
   - **Fallback gate**: `autoMapExistingProductBySku` (the SKU/
     SupplierMapping fallback described above) is skipped entirely when
     `isDuplicatedInCatalog` is true — same effect as the old design (never
     auto-map on an ambiguous code), just decided later and per-job instead
     of at enqueue time. It's also skipped unconditionally when
     `opts.create` is true (see the create-product section below — manual
     creation never tries to reuse an existing product via fallback,
     independent of duplication).
   - **Unmapped registration**: when no product resolves (`opts.create`
     false, mapping + fallback both empty-handed), the row written to
     `UnmappedInvoiceProduct` picks `type: "ERROR_CATALOG_DUPLICATE"` when
     `isDuplicatedInCatalog`, else the original `type: "ERROR_CATALOG"` —
     both share the exact same create/update code path (an upsert keyed on
     `external_id`/`ean` within the integration, unchanged from before),
     just with a computed `type`/`reason` instead of a hardcoded one. This
     also gives duplicate-tracking automatic self-healing for free: since
     every item is now always enqueued and the upsert re-evaluates
     `type`/`reason` on every pass, a code that stops colliding (Tecinco's
     data got cleaned up) flips the existing row from
     `ERROR_CATALOG_DUPLICATE` back to `ERROR_CATALOG` (or the row gets
     deleted outright if it now resolves) on the very next sync — no
     separate cleanup step needed.
   - **`skuOmitted`/`eanOmitted`** (declared as `let`, seeded from the two
     opts flags, right before the `resolveProductWithMapping` call — order
     matters, see the production-bug note further down): these are the
     single mechanism that decides, everywhere downstream in the function
     (product creation, the per-filial `ProductConfig.upsert` calls, both
     `ensureSupplierMappings` calls), whether `sku`/`gtin` get written at
     all. They start out equal to the catalog-duplicate flags but can also
     be set independently by the live `isCodeOwnedByAnotherProduct` check
     in the `opts.create` branch (see below) — once set, the rest of the
     function just checks these two booleans, not `opts.*` directly, so
     both triggers (catalog-wide duplication, and a live per-create
     conflict) converge on identical downstream behavior: never block,
     just leave that one field out of the write.
7. **`UnmappedInvoiceProduct.sku` stores the display code, not the dedup
   key** (applies to every Tecinco site that creates/updates an unmapped
   row — `processProduct`'s own unmapped-registration branch above, and
   `ensureProductsFromInvoiceItems`'s "produto não encontrado" branch):
   `sku` is written as `codigoFabrica ?? epctb_coded ?? null` — código de
   fábrica first, the `epctb_coded` field only as a fallback when there's
   no código de fábrica, matching the same `effectiveSku` rule used for
   duplicate detection above. This is purely for a human reviewer to have
   something readable in the queue; it is **not** used to find/dedupe the
   row. Dedup/identity instead keys off `external_id` (`epctb_codigo`, the
   ERP's own stable id) wherever it's available — i.e. every
   `invoice_id: null` (catalog-scoped) row. The one remaining case with no
   `external_id` available at all is `ensureProductsFromInvoiceItems`'s
   `invoice_id`-scoped unmapped rows (real NF-e line items never carry the
   ERP's own product id, only a supplier code) — there, `sku` is still the
   only identity signal the existing per-invoice reconciliation in
   `invoice-xml.ts` has to key off, so changing what `sku` stores there
   also changes what counts as "the same unmapped item" across
   reprocessing passes for that one case; a pre-existing invoice-scoped
   `UNMAPPED` row keyed on the old value just reads as stale on the next
   pass and gets recreated with the new value — a one-time cost, not a
   functional break. `InvoiceOperationalItemFromXml.sku` (resolved items,
   not unmapped ones) was deliberately **left untouched** — it still
   carries `systemId`, because `findXmlItemForOperationalItem` in
   `invoice-xml.ts` matches it against the NF-e XML's own `cProd`, an
   unrelated concern from the unmapped-queue display code above.

**Reprocessing an invoice that arrived before its product existed already
self-heals, unrelated to any of this**: an item that couldn't resolve gets
recorded as `UnmappedInvoiceProduct` with `invoice_id` set; if/when that
same invoice gets reprocessed later, the pre-existing reconciliation logic
(`invoiceService.addMissingInvoiceItems` + the stale-unmapped-row cleanup
loop, in both `invoice-xml.ts` and `bling-api-fetch.queue.ts`) already
creates the real `InvoiceItems` and deletes the obsolete unmapped row.

### SupplierMapping/ProductConfig duplicate-code protection + manual mapping/create of a duplicate (later same session)

On top of the pre-enqueue safety net above, a second layer stops a
duplicated code from ever being written as a `SupplierMapping` or a
`ProductConfig.sku`, and defines what happens when a human maps/creates a
product from an `ERROR_CATALOG_DUPLICATE` row:

- **`ensureSupplierMappings`/`backfillSupplierMappingByEan`
  (`product.helpers.ts`)** — both wrap their `SupplierMapping.create` in a
  check + try/catch that throws a new `SupplierMappingConflictError`
  (friendly message naming both products by name) whenever the code
  already maps to a *different* product in the same integration — either
  found via an explicit `findOne` first, or via `UniqueConstraintError` on
  the unique `(integrations_id, supplier_product_code)` index (`m263`) as
  a race-safety-net. If it already maps to the *same* product, it's a
  silent no-op (idempotent). `ensureSupplierMappings`'s two call sites in
  `processProduct` (own-product and other-integration branches) convert
  this into `UnrecoverableError` (with an `alertService.sendAlert`) so the
  job fails fast with a clear message instead of retrying forever — this
  remains the **only** place in the whole Tecinco safety net that actually
  throws/blocks; everywhere else, an ambiguous code is just omitted, never
  an error.
- **DB triggers, defense in depth** — `m272` (`trigger_prevent_duplicate_supplier_mapping`,
  mirrors the app-level check above at the DB layer) and `m273`
  (`trigger_prevent_product_config_sku_conflict`, the `ProductConfig.sku`
  equivalent — nothing previously stopped two different products in the
  same integration from both claiming the same `sku`; `m273` also widens
  `m263`'s `prevent_supplier_mapping_gtin_conflict` to check
  `ProductConfig.sku`, not just `.gtin`, closing the same hole from the
  other direction). **`m274` fixed a real production incident these two
  triggers caused**: Postgres fires a `BEFORE UPDATE OF <col>` trigger
  whenever that column appears in the `UPDATE`'s `SET` clause, regardless
  of whether the value actually changes — and `ProductConfig.upsert(...)`
  always includes `sku`/`gtin` in its `SET`. So every *routine* sync of an
  already-mapped product whose `sku` happened to be one of Tecinco's many
  legitimately-duplicated codes (confirmed in production: `sku=48681`
  alone was shared by 62 different products) got permanently blocked by
  its own trigger, even though it was just re-writing the same value that
  was already there — no new collision was being introduced. `m274` adds
  `TG_OP = 'INSERT' OR NEW.<col> IS DISTINCT FROM OLD.<col>` guards to all
  four conflict trigger functions (`m263`/`m264`'s pre-existing two, plus
  `m272`/`m273`'s new two) so they only re-validate when the relevant
  value actually changes. **This DB-level fix was secondary, not the root
  fix** — the real root fix was `skuOmitted`/`eanOmitted` (below), which
  stops the app from ever attempting the conflicting write in the first
  place; `m274` just stops a no-op reaffirmation from being treated as a
  fresh conflict on top of that.
- **`skuOmitted`/`eanOmitted` (final design)** — the app-level answer to
  the same incident, and the mechanism referenced in point 6 above. For
  **any** product already resolved (via mapping or, when un-duplicated,
  via fallback), if its code is flagged duplicated, the per-filial
  `ProductConfig.upsert` and `ensureSupplierMappings` calls simply leave
  that field out of the write (`...(skuOmitted ? {} : { sku: ... })`,
  `ean: eanOmitted ? undefined : ean`) — price/stock/every other field
  still syncs normally. Nothing is ever blocked for a routine sync; the
  product just never gets a `sku`/`gtin` written from an ambiguous source.
- **`opts.create` (manual create-product from an unmapped row) — final
  behavior, after being revised twice this session**: creation **never
  errors** for an ambiguous code either. Before calling
  `createProductFromTCarData`, a **live** check —
  `isCodeOwnedByAnotherProduct({ code, field: "sku" | "gtin",
  integrationsId })` (`product.helpers.ts`, boolean, not throwing) —
  looks for a conflict across `ProductConfig` (any unit_business of the
  integration) and `SupplierMapping` (scoped to the integration). This is
  live rather than payload-flag-driven because the manual create-product
  endpoint's job doesn't necessarily carry the same granular
  `skuDuplicated`/`eanDuplicated` flags `migrateProdutos` computes. On a
  hit, the local `codigoFabrica`/`ean` variable is zeroed and the matching
  `skuOmitted`/`eanOmitted` flag set — the product is still created, just
  without that field (and without a `SupplierMapping` for it), same as the
  routine-sync case. The only intentionally-omitted design considered and
  rejected mid-session was blocking creation outright with a thrown error
  — reverted because the whole point of creating the product anyway is
  that once Tecinco's own data stops colliding, the *next* sync already
  finds the product via its `integration_mapping` and fills in the
  previously-omitted field normally, with zero manual follow-up.
- **Mapping (not creating) an `ERROR_CATALOG_DUPLICATE` row to an existing
  product** — `supplierMappingService.createFromUnmapped`
  (`supplier-mapping.service.ts`) branches on `unmapped.type` at the top:
  for `"ERROR_CATALOG_DUPLICATE"`, it **only** calls
  `integrationMappingService.createOrUpdateIntegrationMapping(...)` and
  deletes the unmapped row — it deliberately never attempts a
  `SupplierMapping` for this case (the code is ambiguous by definition; a
  `SupplierMapping` would either violate `m272`/`ensureSupplierMappings`'s
  own conflict check or just be wrong). Return type is
  `SupplierMapping | null` to reflect this (`null` for the duplicate
  branch). A normal `"ERROR_CATALOG"` row goes through the original,
  unchanged path (`SupplierMapping` + `integration_mapping` as needed).
- **Production bug found and fixed post-deploy, confirmed by a direct
  DB-vs-`tecinco-catalog.json` cross-check after a full catalog upsert**:
  `resolveProductWithMapping` (called at the very top of `processProduct`,
  before mapping resolution even happens) internally calls
  `backfillSupplierMappingByEan` — a **separate**, unconditional path that
  creates a `SupplierMapping` for the raw `ean` argument whenever a
  product resolves via mapping and that EAN doesn't already resolve to
  something in the integration. This call happened *before*
  `skuOmitted`/`eanOmitted` were even computed, so it was never gated by
  them — a duplicated EAN on an already-mapped product could still get a
  `SupplierMapping` created for it through this one specific path, even
  though every other write site correctly omitted it. Confirmed in
  production: 2 real `SupplierMapping` rows created for catalog-duplicated
  EANs this way. **Fixed** by moving the `isDuplicatedInCatalog`/
  `skuOmitted`/`eanOmitted` computation to *before* the
  `resolveProductWithMapping` call and passing `ean: eanOmitted ?
  undefined : ean` into it — `resolveProductWithMapping`'s `ean` parameter
  has no other use than feeding this exact backfill, so gating it there is
  safe and sufficient. If `resolveProductWithMapping` (or any future
  caller of `backfillSupplierMappingByEan`) is touched again: remember
  this function has a real side effect (`SupplierMapping` creation) that
  is easy to miss since the function's own name only suggests read/lookup.
  (`ensureProductsFromInvoiceItems`'s own separate call to
  `resolveProductWithMapping` was deliberately left ungated — per an
  earlier explicit user decision, that flow never creates mappings and
  only reads already-curated data, so it was scoped out of this whole
  safety net from the start, and stays that way.)

### `Product.id_system` overwrite on routine Tecinco sync — production crash + fix, later fully superseded by removing the column (same session)

**Superseded**: the interim fix described below (omit `id_system` on
conflict) was itself replaced later this session by removing
`products.id_system` entirely — see the Products section above. Left here
for the incident history/reasoning, since the same root cause (a column
that can only hold one external id, when a product can legitimately have
several) is exactly what motivated the full removal.

A **third** production incident, found via a real failing job log the user
pasted (`Validation error | constraint=products_id_system_key | detail=Key
(id_system)=(13180) already exists`, retried 5× then alerted). Root cause,
confirmed by the user directly querying prod: `processProduct`'s
"produto próprio" branch (`tecinco-api-fetch.queue.ts`, right before the
`productService.upsertWithComponents(...)` call for an already-mapped
product) unconditionally included `id_system: systemId` in the **update**
values on every sync pass — with no check for whether that value already
belongs to a *different* product. `products.id_system` has a **global**
unique index (see the Products section above), but a single physical
product can legitimately have **more than one** `epctb_codigo` mapped to
it (documented elsewhere in this same section — confirmed real example:
1246/19557 both mapping to one product). Since `id_system` can only hold
one value, blindly resyncing it to "whichever external_id happened to be
processed this pass" is unstable, and in this incident it collided with a
**completely different, legitimately-existing** product that already
owned `id_system="13180"` — the mapped product's own `id_system` was
`"6690"` (its first-synced code), and every subsequent sync of the
`13180` mapping tried to steal `"13180"` away from its rightful owner and
crashed. **Fixed** the same way as the sku/ean omission pattern above:
before the upsert, if `product.id_system !== systemId`, look up
`Product.findOne({ where: { id_system: systemId } })` — if a *different*
product already owns it, `id_system` is left out of the update values
entirely (never overwritten, never blocks); otherwise it updates normally
(so a product created without `id_system` yet, or being corrected, still
gets backfilled). This mirrors `skuOmitted`/`eanOmitted`'s "never block,
just omit the conflicting field" philosophy exactly, just for a
`Product`-level field instead of `ProductConfig`/`SupplierMapping`.
**Bling's equivalent call site** (`bling-api-fetch.queue.ts`, `productValues.id_system
= String(blingProduct.id)`, also unconditional on every update) has the
exact same latent structural risk — not fixed yet, out of scope for this
incident (which was Tecinco-only) and not confirmed as an actual problem
there; if a similar crash is ever reported on the Bling side, this is
where to look first.

### Bling product deactivation (`situacao=E`, this session)

Bling's product payload carries a `situacao` field (`"A"` = active, `"E"` =
excluded/deactivated on Bling's side) that `fetchAndUpsertProduct` didn't
read at all before this session — a product Bling had deleted would just
keep being treated as active on every sync. Now, at the very top of
`fetchAndUpsertProduct`, right after `logPrefix` is built and *before* the
mapping-resolution/KIT/unmapped-registration logic runs:
- The check is a **strict** `blingProduct.situacao === "E"` — any other
  value, including `undefined`/`"A"`, falls straight through to the normal
  flow unchanged. This was a deliberate, explicit ask (a looser check here
  would risk touching active products on a field-shape surprise from the
  API).
- When it matches, `handleDeactivatedBlingProduct` takes over completely
  and the normal flow (KIT sync, Magento sync, `ProductConfig`/`Stock`
  upsert, kardex, unmapped registration) is skipped entirely — **no
  `UnmappedInvoiceProduct` row is ever created for a `situacao=E` product**,
  by design.
- It resolves the local `Product` the same way the normal flow does
  (`resolveProductWithMapping`, mapping-only). If there's no local product
  mapped to it, it's a no-op.

**Design history (important if this gets touched again):** an earlier
version of this same session made `handleDeactivatedBlingProduct` actually
hard-delete the `Product` row (plus its `invoice_items`/`stock_movements`,
guarded by two pre-checks against `MANUAL_ADJUSTMENT` stock movements and
physically-read `batch_invoice_items`). That turned out to be too fragile
in production — real products kept hitting other `RESTRICT` FKs
(`expedition_batch_items`, `inventory_batch_items`,
`kit_components.product_component_id`) that were never guarded, requiring
manual SQL snapshot-and-cleanup to actually delete them. **This was
explicitly reverted and replaced** with the current, much simpler design:

- `handleDeactivatedBlingProduct` **never deletes `Product`,
  `invoice_items`, or `stock_movements`** — all history stays intact, and
  none of those `RESTRICT` FKs are ever at risk since the `Product` row is
  never touched for deletion.
- Instead it strips every reference that makes the product *reachable* by
  code, inside one transaction:
  - `integrationMappingService.bulkDelete({where: {entity_type: "PRODUCT", internal_id: product.id}})` —
    **all** `integration_mappings` for this product, across every
    integration (Bling *and* Tecinco), not just the one that reported
    `situacao=E`. A product retired from one channel is treated as retired
    everywhere.
  - `supplierMappingService.bulkDelete({where: {product_id: product.id}})` —
    all `SupplierMapping` rows for it.
  - `productConfigService.bulkDelete({where: {product_id: product.id}})` —
    all `ProductConfig` rows for it (it loses `sku`/`gtin`/`price` in every
    store it had one).
  - `productService.update(product.id, {is_active: false})` — reuses the
    `is_active` column that already existed on `Product` (`m256`) but had
    nothing writing `false` to it since the old `BlingDirectUpsertQueue`
    delete-handler was removed (see webhook wiring below).
- This self-terminates without any extra logic: once the mapping is gone,
  the *next* `situacao=E` event for that same `blingId` can't resolve a
  local product via `resolveProductWithMapping` at all, so it hits the
  "no local product mapped, no-op" branch above and does nothing — no
  re-attempt, no unmapped row, no update. That's what makes the product
  permanently ignored by the fetch/upsert flow going forward.
- `BatchInvoiceItemsRepository`/`Service.findBlockingByProductId` (the
  `quantity_read` guard from the reverted design) was deleted outright as
  dead code, not just unused — its only caller was the hard-delete path.
- **Webhook wiring (this session)**: `bling-webhook.mapper.ts`'s `mapProduct`
  used to special-case `action === "deleted"` into a `directUpsert: {table:
  "delete", ...}` job on `BlingDirectUpsertQueue`, whose `handleDelete`
  handler just set `is_active: false` — no cleanup of dependent rows, and
  no knowledge of `situacao` at all. `product.deleted` is now routed
  through the **same** `requiresApiFetch` path as `created`/`updated` (no
  more special-casing by action in `mapProduct`), so `BlingApiFetchQueue.fetchAndUpsertProduct`
  fetches the current product from the API and decides what to do from the
  fresh `situacao` value — Bling's "delete" isn't a real deletion on their
  side either, the product just flips to `situacao=E` and stays fetchable
  at `/produtos/:id`. The `"product"` case in `BlingDirectUpsertQueue.handleDelete`
  was removed as dead code (its `is_active=false` behavior is superseded by
  `handleDeactivatedBlingProduct` above, which does that and more);
  `"invoice"`/`"consumer_invoice"`/`"product_supplier"` deletes are
  unaffected, still going through `directUpsert`.

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
- **Confirmed hitting this in production (Tecinco, this session)**: the
  user manually mapped ~53 `ERROR_CATALOG` unmapped rows via the
  create-product flow for one unit_business; ~4h later the same
  `integrations_id` had 38 `ERROR_CATALOG` rows again, 34 of them the exact
  same product (same `external_id`/name) as ones just mapped. Root cause
  was this pre-`m268` orphan backlog, not a per-branch scoping issue —
  `unit_businesses.integrations_id` is shared by every Tecinco filial (one
  `integrations` row for the whole tenant) and Tecinco's `epctb_codigo` is
  itself global (`/produtos?branch_ids=...` returns one row per code with
  a `filiais` sub-array for per-branch stock/price), so the user's
  assumption that mapping once should cover every Tecinco branch was
  correct — that is not where the bug is. The actual sequence: a prior
  (pre-`m268`) product deletion had already orphaned the `integration_mappings`
  row for that `external_id`; the create-product flow created a brand-new
  `Product` fine, but `createOrUpdateIntegrationMapping` silently no-op'd
  against the stale orphan (still pointing at the deleted product's id)
  instead of writing a mapping for the new product;
  `resolveFromCreatedProduct` still deleted the unmapped row regardless, so
  the manual mapping *looked* successful in the UI. On the next catalog
  sync, `resolveProductByMappingOnly` found the orphan, tried to load its
  `internal_id`, got nothing (product doesn't exist), so
  `resolveProductWithMapping` returned null and the item was re-registered
  as a brand new `UnmappedInvoiceProduct` — indistinguishable from "never
  mapped" to anyone looking at the queue. Reproduced by querying the DB
  directly: 20 of the 38 rows had a matching local `Product` (by
  `id_system` = the unmapped row's `external_id`) with zero
  `integration_mappings` of its own, while a stale mapping for that same
  `external_id` pointed at a nonexistent `internal_id` — 21 such orphaned
  `PRODUCT`/Tecinco mappings exist in total. **Still unfixed**: the
  pre-existing orphan backlog needs a one-off cleanup (delete
  `integration_mappings` rows whose `internal_id` has no matching row in
  the table named by `entity_type`) before manual re-mapping of these
  particular products can succeed. (At the time this was found,
  re-attempting create-product for the same `external_id` hit an
  `id_system` conflict guard in `createProductFromTCarData` and threw an
  `UnrecoverableError` instead of silently repeating — that guard no
  longer exists, since `products.id_system` was removed entirely later
  this session; see the Products section above. The orphan backlog itself
  is unaffected by that removal and is still unresolved.)
- **Fixed this session — `createOrUpdateIntegrationMapping` used to also
  block by `internal_id`, not just `external_id`.** Found via a second,
  distinct production case (also Tecinco): a product already had a valid
  (non-orphaned) mapping for `external_id=20517`; a `SupplierMapping` +
  `UnmappedInvoiceProduct` existed for the *same physical product* under a
  *different* `external_id=13216` (confirmed by the user: **normal on
  Tecinco** — the same tire legitimately gets more than one `epctb_codigo`,
  e.g. across filiais/duplicate catalog entries). Calling
  `supplierMappingService.createFromUnmapped` for the `13216` row created
  the `SupplierMapping` fine, but the old query —
  `where: {entity_type, integrations_id, [Op.or]: [{internal_id}, {external_id}]}`
  — matched the *existing* `20517` mapping purely by `internal_id`, so the
  `13216` mapping was silently never created (just a `console.warn`, same
  silent-no-op as the orphan case above but a different root cause: this
  mapping wasn't orphaned, it just already existed for a different code).
  Every subsequent catalog sync for `13216` kept re-registering it as
  unmapped, forever, since nothing ever closed that specific loop. **Fixed**:
  the existence check is now scoped to `external_id` only — a mapping is
  only refused when *that exact* `external_id` already points at a
  *different* `internal_id` (the real conflict this function exists to
  prevent — silently reassigning one code to another product). The same
  `internal_id` having other `external_id` rows in the same integration is
  now explicitly allowed and expected, not blocked. Covered by
  `src/modules/integrations/integration-mapping/__tests__/integration-mapping.service.test.ts`
  (new this session) — in particular the case "mesmo internal_id já tem
  mapping pra outro external_id: cria um novo mesmo assim".
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
  - **`type` column** (`m269`, this session): categorizes *why* a row is
    unmapped, independent of `reason` (free text) and `integrations_id`
    (which integration) — set at every create/upsert site above:
    `ERROR_CATALOG` (catalog-sync, no mapping — the only type eligible for
    the create-product flow), `ERROR_INTEGRATION` (cross-check against a
    system that isn't the product's ERP of origin, e.g.
    `syncProductWithMagento` — mapping-only, never creates a Product),
    `ERROR_INVOICE` (invoice-line item unresolved, both the Bling API path
    and `invoice-xml.ts`), `ERROR_SCAN` (manual EAN-photo lookup miss,
    `createUnmappedFromReadingEan` — the only case with no `integrations_id`
    tie to a catalog or invoice flow), and `ERROR_CATALOG_DUPLICATE` (`m271`,
    later this session — Tecinco-only, a catalog code that collides with a
    different product elsewhere in the Tecinco catalog; see "Auto-map by
    SKU/SupplierMapping... + Tecinco catalog-duplicate safety net" above —
    deliberately inert, not eligible for create-product like `ERROR_CATALOG`
    is). `filterableFields` now also includes
    `type`, `integrations_id`, `reason`, `product_name`, `external_id`,
    `ean`, `sku` (all exact-match, same mechanism as the pre-existing
    `status`/`invoice_id` filters) alongside the existing free-text
    `search` over `product_name`/`ean`/`sku`. `m269`'s backfill `UPDATE`
    needed an explicit `::"enum_unmapped_invoice_products_type"` cast (a
    bare `CASE` of string literals defaults to `text` in Postgres, which a
    plain assignment into an enum column rejects) — and the migration
    itself had to be made idempotent (guard `ADD COLUMN` with
    `describeTable`, add `WHERE type IS NULL` to the backfill) because
    sequelize-cli does **not** wrap a migration file's `up()` in a
    transaction here, so the first (failing) run had already committed the
    `ADD COLUMN` before erroring on the cast.
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
  1. **(Removed this session, along with `products.id_system` itself — see
     the Products section above.)** Used to check `Product.findOne({
     where: { id_system } })` for a pre-existing orphaned-mapping conflict
     before creating. There's nothing left to check that against now;
     creation goes straight to step 2, relying entirely on
     `resolveProductWithMapping` (already run by the caller) plus the
     EAN/SKU conflict handling (`assertEanNotOwnedByAnotherProduct`,
     `isCodeOwnedByAnotherProduct`) documented elsewhere in this file.
  2. Calls `productService.create(...)` (wrapped in try/catch,
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
  `assertEanNotOwnedByAnotherProduct`'s `EanConflictError` message and
  `SupplierMappingConflictError` for the concrete pattern.

## Invoices / fiscal (`src/modules/warehouse/fiscal/invoices/`)

- `invoice/` — `Invoice` model/service/repository/controller, plus
  `invoice-label.service.ts` (resolves EAN for printed labels) and
  `helpers/totals.ts` (`totalExpectedLiteral`/`totalReadLiteral`).
- `invoice-items/` — `InvoiceItems`; resolves the product/config for each
  line using the standard priority order below. `InvoiceFiscalItem` is a
  sibling model in its own `invoice-fiscal-item/` folder with no
  repository/service/controller of its own (just `.model.ts`/`.types.ts`)
  — it's queried/written directly wherever needed (`invoice.repository.ts`,
  `invoice.service.ts`, `invoice-items.service.ts`), not through a
  dedicated layer.
- **Fixed this session — duplicate-key crash in `addMissingInvoiceItems`**
  (`invoice.service.ts`, the reprocess path used when an NF-e's `existingInvoice`
  is found in `invoice-xml.ts`): it only checked `InvoiceItems` to decide
  which incoming product_ids were "already handled" for the invoice, then
  inserted `InvoiceFiscalItem` unconditionally for the rest. Both tables
  share the identical `UNIQUE(invoice_id, product_id)` constraint
  (`invoice_items` via `uq_invoice_items_invoice_product`,
  `invoice_fiscal_items` via `invoice_fiscal_items_invoice_id_product_id_unique`),
  and it's an accepted, designed scenario (see "Auto-map by SKU/SupplierMapping"
  above) for two different Tecinco `epctb_codigo`s to resolve to the same
  local `Product` — so a product_id could already have an `InvoiceFiscalItem`
  row (e.g. from an earlier pass that got this far and committed, then
  failed/retried for an unrelated reason) without yet having an
  `InvoiceItems` row for this exact call's input set, and the old check let
  it through to a raw Postgres constraint error instead of skipping it.
  Fixed by checking **both** `InvoiceItems` and `InvoiceFiscalItem` for
  existing `(invoice_id, product_id)` pairs before filtering. If this
  function is touched again, keep both checks — checking only one table is
  the exact bug that was fixed.
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

## Bling NFe web-scraping automation (`.../bling-nfe/automations/auto-manifest/`)

- `BlingManifestacaoService`/`BlingNfeScrapingQueue` (queue
  `BLING_NFE_SCRAPING`, runs on `worker-scraping`, every 3h) automates
  "manifestar nota como operação realizada" through Bling's own web UI
  (`notas.entrada.php`) via Playwright — no public API for this action.
  Uses a persistent browser profile (`./bling_session`) shared with
  `get-stock-movements.ts`, which logs in the same way but against
  `estoque.php`.
- **Fixed this session**: login kept failing only on this flow (100% of
  runs), while `get-stock-movements.ts` worked fine with the same
  credentials/profile. Root cause: `ensureLoggedIn`/`doAutoLogin` checked
  `page.url()` right after `waitUntil: "domcontentloaded"` — too early for
  Bling's SPA to render, so the login-diagnostic screenshot (also added
  this session, mirroring `get-stock-movements.ts`'s `logLoginPageState`)
  showed an unrendered page (`#username=0`, empty body) that looked like a
  login wall. `get-stock-movements.ts` already used `waitUntil:
  "networkidle"` + a settle wait; this file used `domcontentloaded` with
  none. Fixed by switching both `page.goto` calls in the login flow to
  `networkidle` and adding the same ~1.5s settle wait. If either file is
  touched again, keep `networkidle` for Bling's pages — `domcontentloaded`
  isn't enough to trust `page.url()`/DOM state on a client-rendered page.

## ML → Bling NFe scheduling pipeline (`src/modules/handlers/mercado-livre/`, `.../bling-nfe/`)

**Referência completa do pipeline** (as 6 filas, precondição/escrita de
cada uma, a tabela de estados `OrderInternalStatus` ↔ situação Bling, o
lock por pedido, e todo par de corrida entre filas já mapeado e tratado):
`docs/automation/order-pipeline.md`. Mantenha esse arquivo atualizado, não
este — os bullets abaixo ficam só com o histórico de investigação/fix de
sessão, não a referência viva.

- **`setDelayBasedOnDate(date)`** (`src/shared/utils/queues/setDelay.ts`) —
  computes the delay for the NFe-emission BullMQ job. As of this session:
  targets the **same day** as `collection_date` at 07:00 BRT (10:00 UTC);
  if "now" is already past 13:00 BRT (16:00 UTC) on that day, targets the
  **next day** at 07:00 BRT instead. Used by both
  `MLOrderSyncQueue.scheduleNfe` (`mercado-livre-sync.queue.ts`) and
  `ReconcilerQueue.reconcileWaitingNfe` (`nfe-reconciler.queue.ts`) — same
  formula for both, no per-caller override anymore (the old "1 day before
  collection, forced-immediate if collection is tomorrow" behavior and the
  `isNextDay` special case were removed as no longer needed: the new
  formula already produces the right delay for every case, including
  "collection is tomorrow").
- **`reconcileStuckOrders`** (`nfe-reconciler.queue.ts`) marks an order
  `WAITING CHANNEL VALIDATION` for longer than a threshold as "aguardando
  verificação humana" (Bling situação `748772`). **This threshold was
  tuned to 10min then reverted to 30min the same session** after a real
  production incident: 10min is shorter than the ML scraping cycle's own
  real-world latency (see below), so orders still in normal transit (not
  actually stuck, just waiting for their first scraping match) were being
  swept into human-review before scraping ever got a fair shot at them —
  "quase todos os pedidos" started landing in aguardando verificação
  humana instead of reaching `WAITING FOR NFE EMISSION`. If this threshold
  is tuned again, verify against real scraping-cycle timing first, not
  just the reconciler's own polling interval.
- **`MLScrapingQueue`** (`ML-SCRAPING`, downloads/parses the Mercado Livre
  order spreadsheet) — cadence tuned 20min → 5min → **10min** this
  session. 5min was too tight: each cycle itself takes ~2min to start +
  ~3min to run (~5min total), leaving no idle gap between cycles and
  starving other Bling-lock queues (see below). 10min gives real breathing
  room.
- **`BLING_SHARED_QUEUE_LOCK`** (`bling/services/bling/queues/bling-queue-lock.ts`)
  — rank-based priority (Redis ZSET, `score = rank*1e14 + timestamp`, lowest
  score always goes next). Confirmed in production: an order sat in
  `WAITING CHANNEL VALIDATION` for 6+ days, fully matching
  `reconcileStuckOrders`'s query (verified live), yet was never processed —
  `NFE_RECONCILER` (and worse, `NFE_EMISSION`, the queue that actually
  emits the NFe) were ranked near the bottom, so a sustained stream of
  `BLING_API_FETCH` webhook traffic (rank 1 at the time) could always cut
  in line ahead of them. **Fixed in an earlier session**: `NFE_EMISSION`
  and `NFE_RECONCILER` moved to ranks 1-2 (highest priority) — current
  order: `NFE_EMISSION:1, NFE_RECONCILER:2, BLING_API_FETCH:3,
  BLING_STOCK_MOVEMENTS_SCRAPING:4, BLING_ORDER_INGESTION:5,
  CNPJ_VERIFY_CNAE:6, ML_ORDER_SYNC:7, BLING_NFE_SCRAPING:8,
  BLING_RECONCILER:9`.
  **Starvation resurfaced for `ML_ORDER_SYNC` (rank 7), fixed this
  session by adding aging** — this is the exact class of bug the previous
  fix's own note predicted ("if starvation resurfaces for some other
  queue, the real fix is adding aging, not reshuffling ranks"). Symptom
  reported by the user: every order was landing in "aguardando
  verificação humana" (`reconcileStuckOrders`'s `ERROR_CATALOG`-style
  sweep, unrelated queue but same mechanism as the bug above) even though
  `MLScrapingQueue`'s logs showed every order's `collection_date` being
  found correctly. Root cause: `ML_ORDER_SYNC` is the *only* thing that
  writes `collection_date` onto the order (via `syncFromExcel` →
  `applyCollectionDate`) — under sustained `BLING_API_FETCH` webhook
  traffic (rank 3) and `NFE_RECONCILER` running every 15min (rank 2),
  `ML_ORDER_SYNC`'s tickets could never become the ZSET's front-of-line
  member (the old `isNextSharedLockPriorityTicket` check only lets the
  single lowest-score ticket try the lock, with no way for a lower rank
  to ever overtake a higher one), so its jobs sat retrying every 500ms
  indefinitely while `NFE_RECONCILER`'s `reconcileStuckOrders` (which
  doesn't need the lock to decide — just a >30min-stuck timestamp check)
  kept sweeping those same orders into human review before `ML_ORDER_SYNC`
  ever got a turn to apply the collection date it had already found.
  **Fix**: `BaseQueueService` (`base-queue-service.ts`) now supports
  `sharedLock.priority.agingIntervalMs` (new
  `applySharedLockPriorityAging` method) — every time a waiting ticket
  rechecks the lock, it re-`ZADD`s its own score with an *effective* rank
  that improves by 1 for every `agingIntervalMs` elapsed since it first
  started waiting (floored at rank 1, never above the best-defined tier;
  uses Redis `ZADD ... LT` so a ticket's score only ever improves, never
  regresses). `BLING_SHARED_QUEUE_LOCK` sets `agingIntervalMs: 2*60*1000`,
  so a rank-7 ticket reaches rank 1 within ~12 minutes of sustained
  contention — comfortably inside the 30-minute `reconcileStuckOrders`
  window — while still respecting the original ranking the rest of the
  time. The `maxWaitMs` safety valve (default 60min, unchanged) still
  only fires a `HIGH` alert on top of this, it doesn't itself boost
  priority.
- **A second, more severe starvation class fixed this session: the lock
  was held for an entire `process(job)` execution, not per Bling call.**
  Reported by the user as three symptoms of the same root cause: "everything
  stuck for a while, eventually someone wins" (e.g. `BLING_ORDER_INGESTION`),
  and "a job's wait released but it's still stuck even with nothing ahead
  of it" (`ML_ORDER_SYNC`). Root cause: `processWithSharedLock` (the
  automatic per-job wrap) acquires the lock **once** at the start of
  `process(job)` and only releases it in the `finally` when the whole job
  finishes. That's fine for one-item-per-job queues (`NFE_EMISSION`,
  `ML_ORDER_SYNC`, `CNPJ_VERIFY_CNAE`, `BLING_ORDER_INGESTION`,
  `BLING_API_FETCH`), but `NFE_RECONCILER`'s `reconcileStuckOrders` and
  `BLING_RECONCILER`'s `reconcileOpenOrders`/`syncInvoicedOrCollectedOrders`
  each loop over **many orders in one job**, with real Bling round-trips
  (and, in `reconcileStuckOrders`, explicit `1s`+`3s` sleeps) per order —
  so one execution of either queue could hold the *entire* shared lock for
  minutes (bounded only by `maxProcessingMs`, 15min for both), blocking
  literally every other Bling queue regardless of rank the whole time.
  Worst case was `BLING_RECONCILER`: it's rank **9** (the lowest, by
  design), yet once it acquired the lock it could still block
  `NFE_EMISSION`/`NFE_RECONCILER` (ranks 1-2) for the rest of its loop —
  ranking alone only decides who goes *next*, it can't preempt a lock
  already held.
  **Fix**: `BaseQueueService` gained `sharedLock.manual` (constructor
  option) and a public `withSharedLock(sharedLock, fn)` method. When
  `manual: true`, the constructor stops auto-wrapping `process(job)` with
  the lock entirely — the queue itself must call `withSharedLock` around
  each unit of work. `registerSharedLockPriorityTicket`/`tryAcquireOnce`
  were generalized to take a plain `(member, timestamp)` instead of a
  BullMQ `Job`, since `withSharedLock` isn't tied to a job. Both
  `ReconcilerQueue` (`nfe-reconciler.queue.ts`) and `BlingReconcilerQueue`
  (`bling-reconciler.queue.ts`) now set
  `sharedLock: { ...BLING_SHARED_QUEUE_LOCK, manual: true }` and wrap
  **each individual Bling call** in their loops with
  `this.withSharedLock(RECONCILER_SHARED_LOCK, () => blingGet/Put/Patch(...))`
  — including releasing the lock during `reconcileStuckOrders`'s 1s/3s
  sleeps between calls, not just between orders. Net effect: these two
  reconciler jobs can still take a while wall-clock (bounded by
  `maxProcessingMs` as before), but they no longer monopolize the lock
  while doing it — every other Bling queue gets to interleave between
  each of their individual API calls, based on the same rank+aging
  ordering as before. If a new queue is added that loops over many items
  per job and needs the shared lock, use `manual: true` +
  `withSharedLock` per item from the start — the "one lock per job" default
  is only correct for queues that process a single item per job.
- **Superseded later the same session: `BLING_SHARED_QUEUE_LOCK` (rank+aging,
  above) was replaced by a per-ORDER lock for the whole order pipeline —
  `NFE_EMISSION`, `NFE_RECONCILER`, `BLING_ORDER_INGESTION`,
  `CNPJ_VERIFY_CNAE`, `ML_ORDER_SYNC`, `BLING_RECONCILER`.** Only
  `BLING_API_FETCH` still uses `BLING_SHARED_QUEUE_LOCK` (product/invoice
  catalog sync, a different domain from orders — the two never needed to
  coordinate with each other). Two separate things motivated this:
  1. **User-asked investigation**: is the cross-queue mutex even needed for
     Bling rate-limit protection, given `waitForBlingRateLimit()` already
     paces every Bling call globally regardless of which queue issues it?
     Confirmed: no, the mutex was never actually protecting Bling's rate
     limit — that's fully independent. But investigating turned up a real,
     separate risk the mutex *was* incidentally masking: **no write to
     `orders` (`internal_status`/situação) has optimistic locking, a version
     column, or a transaction** (`OrdersService.update` → plain
     `findByPk` + `record.update`, no lock) — and at least 5 queues
     (`nfe-reconciler`, `mercado-livre-sync`, `cnpj`, `nfe.queue`,
     `bling-reconciler`) do read-modify-write on an order's status with a
     real gap (network calls, sleeps) between the read and the write. Fully
     removing the mutex with no replacement would have let two queues
     genuinely race on the same order (lost update). Per-order locking
     keeps that protection (same order still fully serialized) while
     removing the *unrelated* cost of serializing every order behind every
     other order.
  2. **Confirmed production throughput bug**, reported by the user: even
     after the lock-scoping fix above, a burst of new orders still got
     stuck — 100 new orders arriving produced a backlog of ~175
     `ML_ORDER_SYNC` jobs (mostly `MLScrapingQueue` row-matches, not just
     the new orders' own webhook jobs), and because `ML_ORDER_SYNC` had
     `concurrency: 1` + a BullMQ `limiter: {max:1, duration:3000}`, the
     queue's own throughput was hard-capped at 1 job/3s — **175 × 3s ≈
     8.75min minimum just to cycle the backlog once**, before any actual
     Bling round-trips. New orders queued behind that backlog took long
     enough that `NFE_RECONCILER`'s 30-minute stuck-order sweep fired
     before `ML_ORDER_SYNC` ever got to them, marking them "aguardando
     verificação humana" even though the ML scraping had already found
     their collection date. The pipeline the user described —
     `BLING_ORDER_INGESTION → CNPJ_VERIFY_CNAE → ML_ORDER_SYNC →
     NFE_EMISSION`, sequential *per order* — was being serialized
     *globally* by both the old cross-queue mutex and each queue's own
     conservative `concurrency`/`limiter`, when it only ever needed to be
     sequential per order. The user's own framing: "a automação deve ser
     rápida — entrou pedido já roda tudo pra emitir logo ou agendar."
  - **`BaseQueueService.withOrderLock(orderKey, fn, options?)`**
    (`base-queue-service.ts`) — new primitive alongside `withSharedLock`:
    a plain Redis `SET key NX PX` mutex keyed dynamically
    (`locks:bling:order:${orderKey}`) instead of one fixed key. No
    priority ticket/ranking/aging at all — contention here should be rare
    (two things touching the exact same order at once), so a bounded
    retry (default `maxWaitMs` 2min, `retryDelayMs` 300ms) that just
    throws on timeout is enough; the job then fails and retries later via
    BullMQ's own attempts/backoff, same as any other transient failure.
    Reuses the same key-agnostic `refreshSharedLock`/`releaseSharedLock`
    helpers `withSharedLock` uses.
  - **The lock key is the Bling order id** (`id_order_system` once
    persisted; the raw webhook `data.id` in `BlingOrderQueue` before a
    local row necessarily exists yet) — the one identifier present at
    every pipeline stage, so all 6 queues contend correctly against each
    other for the *same* physical order regardless of which queue reaches
    it first.
  - **Not reentrant** — a Redis NX lock can't be acquired twice by the same
    logical flow. Every migrated queue locks at exactly one entry point per
    call chain and documents it: `NFeQueue.process` locks once, delegating
    to a private `processOrder`; `MLOrderSyncQueue.applyCollectionDate`/
    `syncFromWebhook` lock once each and delegate to `*Locked` siblings
    that call `scheduleNfe` *without* it re-locking (comment on
    `scheduleNfe` calls this out explicitly). `NFeQueue.onFailed` runs
    *after* `process()`'s own lock was already released (the job already
    exited), so it re-acquires the lock itself before calling
    `markOrderCancelled` again.
  - **The two big-loop reconcilers got simpler, not just re-keyed**: since
    fairness-between-queues is no longer a concern (different orders don't
    contend with each other at all now), `nfe-reconciler.queue.ts`'s
    `reconcileStuckOrders` and `bling-reconciler.queue.ts`'s
    `syncInvoicedOrCollectedOrders` went from 3 separate
    `withSharedLock` acquisitions per order (one per Bling call, to let
    other queues interleave between them) back down to **one**
    `withOrderLock` per order covering that order's whole sequence
    (GET+sleeps+PUT+PATCH) — simpler, and correct, since nothing else needs
    to interleave mid-order anymore. Page-level listing GETs (not tied to
    one order) and `getMercadoLivreStoreId()` lost their lock entirely —
    they were never protecting anything per-order.
  - **Concurrency raised on the 4 single-item queues**, now that Bling
    pacing is fully independent of queue-level throttling:
    `NFE_EMISSION`/`CNPJ_VERIFY_CNAE`/`BLING_ORDER_INGESTION` concurrency
    1→5, `ML_ORDER_SYNC` 1→10 (the queue that actually had the reported
    backlog); their old conservative BullMQ `limiter`s were removed or
    loosened to match — the real Bling-side cap is `waitForBlingRateLimit()`
    alone, these per-queue limits were redundant and, per the incident
    above, actively harmful under a real backlog.
- **Per-order locking closes corruption from two queues writing the same
  order at once, but not one queue arriving too early on a transition
  another is about to make** — the user asked for a systematic audit of
  every queue pair in the 6-queue order pipeline for this shape of race
  (not just the `reconcileStuckOrders`/`ML_ORDER_SYNC` pair already known).
  Full reference of the pipeline as it stands today — the 6 queues'
  preconditions/writes, the state table, the lock, and every queue-pair
  coordination case — now lives in `docs/automation/order-pipeline.md`
  (kept as a living doc, not a changelog — update it, not this file, when
  describing current behavior). What changed this session, for history:
  - `reconcileStuckOrders` now waits for `ML_ORDER_SYNC` to go idle
    (`BaseQueueService.waitUntilIdle`, event-driven via BullMQ's
    `"drained"` event — no polling) before sweeping, capped at 5min, since
    "situação still 748743" can't distinguish a genuinely abandoned order
    from one `ML_ORDER_SYNC` just hasn't reached yet.
  - **Real structural bug, not just a timing race**: the
    `lock_today_orders` branch of `scheduleNfe` writes
    `WAITING_FOR_NFE_EMISSION` + `waiting_acceptance: true` without ever
    PATCHing Bling to `748748`; `POST
    /orders/release-waiting-acceptance-for-today` only flipped the DB flag
    back to `false` and never resumed the actual scheduling — so every
    order released through that endpoint got picked up later by
    `reconcileWaitingNfe` (recreating the missing emission job with Bling
    still at `748743`) and `NFE_EMISSION` then bounced it to human review.
    Fixed by giving `MLOrderSyncQueue` a `resumeAfterAcceptance(orderId)`
    entry point (routed via a new `{resumeOrderId}` job-data shape) that
    finishes the scheduling for real; `releaseWaitingAcceptanceForToday`
    now selects affected orders *before* the update and returns the full
    list so `OrdersController` can enqueue one resume job per order.
  - `reconcileWaitingNfe` (the one `NFE_RECONCILER` routine that had no
    `withOrderLock`) and `BLING_RECONCILER`'s `syncInvoicedOrCollectedOrders`
    (which decided its PATCH from a per-page order snapshot instead of
    rereading the order's `situacao`/`collection_date` fresh inside the
    per-order lock) both got smaller fixes in the same pass — see the doc
    for current behavior.
  - **Follow-up in the same session**: `finalizeNfeScheduling` — the
    shared tail of both `scheduleNfe` and `resumeAfterAcceptance` that
    does the actual PATCH to `748748` — used to trust only the local
    `isEligibleForSync` snapshot (`source_payload`, populated by the last
    webhook `BLING_ORDER_INGESTION` processed) before writing. Added a
    live `blingGet` + `mapOrderInternalStatus` check right before the
    PATCH: if Bling's situação isn't still `748743` (e.g. the order was
    cancelled directly on Bling while sitting in `waiting_acceptance`),
    it syncs `internal_status` to match reality and skips scheduling
    instead of blindly overwriting. Matters most for
    `resumeAfterAcceptance`, where the gap between an order getting locked
    and someone manually releasing it can be far longer than the normal
    gap `isEligibleForSync` alone was ever tolerant of.
- **Bling's API rate limit is per ACCOUNT, not per app/OAuth client**
  (confirmed at developer.bling.com.br/limites: "limites... não específicas
  por endpoints, mas sim para todas [requisições da conta]" — 3 req/s,
  120k/day; IP gets blocked 10min on 300 errors/10s or 600 requests/10s,
  60min on 20 `/oauth/token` requests/60s). Registering a second Bling app
  does **not** get a separate quota — it shares the same account-wide
  budget. This means every code path that talks to Bling, regardless of
  auth mechanism, must respect the same pacing.
  `waitForBlingRateLimit()` (`bling/api/bling_api.service.ts`) is the
  single Redis-backed leaky-bucket limiter (atomic Lua `EVAL`, so
  provably race-free across any number of concurrent callers), called
  from the `blingApi` axios instance's `onRequest` interceptor (covers
  every GET/POST/PUT/PATCH/DELETE through that instance) and also from
  the two Playwright/cookie-session scrapers that bypass the OAuth
  `blingApi` axios instance entirely (`get-stock-movements.ts`'s
  `fetchLancamentosPage`, and `nfe-manifest-web-scraping.service.ts`'s
  page navigations + the `#btnManifestarLote` click) — those were
  previously invisible to the rate limiter despite consuming the same
  account-wide quota. `BLING_API_FETCH`/`invoice`/`stock` webhook
  processing itself was ruled out as a direct 429 cause: verified
  read-only (no `blingApi.post/put/patch/delete` in that file), no
  concurrent fan-out (`Promise.all`), `concurrency: 1`, and the
  physical-stock lookup is properly batched per invoice (not N+1 per line
  item) — 2 sequential Bling GETs is the normal case per webhook event.
  **Revisited this session** (user reported 429s "estourando toda hora"
  despite `BLING_RATE_LIMIT_INTERVAL_MS=1500` + a manually-added 2000ms
  extra delay in `blingGet` — combined that's already well under Bling's
  3 req/s limit on paper, so the interval itself wasn't the likely
  culprit). Found and fixed two real gaps instead:
  - `handleBlingOAuthCallback`'s token-exchange `fetch()` had **no
    timeout at all** (inconsistent with `doRefreshToken`'s sibling call,
    which already had `AbortSignal.timeout(30_000)`) — added the same
    30s timeout.
  - Every Bling write call (POST/PUT/PATCH) across `cnpj.queue.ts`,
    `bling-reconciler.queue.ts`, `nfe-reconciler.queue.ts`, `nfe.queue.ts`,
    `mercado-livre-sync.queue.ts`, and `bling.service.ts`'s one GET, were
    calling `blingApi.get/post/put/patch` directly — bypassing the extra
    `BLING_ORDER_REQUEST_DELAY_MS` pacing buffer that only the `blingGet`
    helper applied, and relying solely on the shared axios instance's
    single global timeout with no per-call override. `get-with-sleep.ts`
    now exports `blingGet`/`blingPost`/`blingPut`/`blingPatch` — all four
    apply the same pacing + an explicit per-call timeout (`
    BLING_REQUEST_TIMEOUT_MS`, default 20s; NFe generation
    (`/gerar-nfe`) explicitly overrides to 45s since it involves Bling
    talking to SEFAZ and can be slower) — and every production call site
    above was migrated onto these wrappers, so no write call is timeout-
    or pacing-inconsistent with reads anymore.
  - `BLING_RATE_LIMIT_INTERVAL_MS` default raised 1500ms → 2000ms for
    extra headroom, per explicit user request.
  - Left as an open, documented hypothesis (can't be verified from code
    alone): if 429s persist after this, the two most likely remaining
    causes are (a) a different process/environment — another deploy, or
    a manual maintenance script under `src/scripts/bling/` — pointed at a
    **different Redis** than production, so it paces its own requests
    correctly but uncoordinated with the shared limiter; or (b) a
    temporary IP ban already in effect (300 errors/10s or 600 requests/10s
    → 10-60min block per developer.bling.com.br/limites), which makes
    every request fail for the whole ban window regardless of current
    pacing — this can look exactly like "estourando toda hora" in logs
    even though it's really one earlier burst still being paid for.
- **Known follow-up, not yet done**: `BlingNfeScrapingQueue`'s
  `scheduleRepeat({ every: 3 * 60 * 60 * 1000 })` (`src/queues/index.ts`)
  has no `cron`/`tz` anchor, so it drifts across all hours of the day
  (anchored to whenever the process booted) and can land in the middle of
  peak webhook traffic instead of a predictable off-hours slot like
  `BLING_STOCK_MOVEMENTS_SCRAPING`'s `cron: "0 5 * * *"`.

## Tecinco API auth/session (`src/modules/handlers/tecinco/api/tecinco_api.ts`)

- `sessionPool` (a `Map<branchId, TCarBranchSession>`) caches one session
  token per branch, in memory only — lost on every process restart. Both
  `ensureSession` (cache-miss login) and `onResponseError`'s 401 handler
  (session-expired relogin) call `doTCarLogin(branchId)`, and each already
  serializes concurrent calls *for the same branch* via the branch's own
  `isRefreshing`/`failedQueue`.
- **Fixed this session — intermittent 403 on `/auth/login`**: `doTCarLogin`
  uses the *same* account credentials (username/password/api_key/company_id)
  for every branch — only the later `/auth/session/branch` call differs by
  branch. The per-branch lock above doesn't stop two *different* branches
  from calling `/auth/login` at the same time (e.g. `TCarSyncQueue`
  dispatches one job per branch — currently branches `12`/`17` — and both
  can run concurrently right after a process restart or whenever both
  branches' cached tokens are empty at once). Tecinco's API appears to
  reject one of two concurrent logins for the same account with a bare 403
  (not 401/429, so neither existing retry path in the response interceptor
  catches it) — this matched the observed pattern of ~3% of requests
  failing with a plain "Request failed with status code 403" whose stack
  trace bottoms out in `doTCarLogin`, not in any other endpoint. Fixed by
  wrapping `doTCarLogin`'s entire body in a **module-level** (not
  per-branch) promise-chain mutex (`withTCarLoginLock`), so logins for
  different branches queue up instead of racing — this covers both call
  sites (`ensureSession` and the 401 relogin path) since both go through
  `doTCarLogin`.
- **`TCAR_UPSERT`/`TCAR_SYNC` deliberately do NOT share a BullMQ
  `sharedLock`** (unlike Bling's queues, which share
  `BLING_SHARED_QUEUE_LOCK` — see the Bling NFe section above and
  `bling-queue-lock.ts`). This was considered and rejected: `TCarSyncQueue.process`
  (`tecinco-sync-queue.ts`) calls `runMigration`
  (`tecinco-migration.runner.ts`), which enqueues jobs onto `TCAR_UPSERT`
  and then blocks on `waitForQueueToDrain(upsertQueue, ...)` as part of the
  *same* sync job. A full job-level `sharedLock` between the two queues
  would deadlock: the sync job holds the lock while waiting for
  `TCAR_UPSERT` to drain, but `TCAR_UPSERT` jobs can never acquire that
  same lock to run and drain. The module-level login mutex above already
  serializes the actual race (concurrent `/auth/login` calls) without this
  risk, since both queues funnel through the same `doTCarLogin`. If queue-level
  coordination between `TCAR_UPSERT`/`TCAR_SYNC` is wanted later, it needs
  a narrower lock scoped to the individual Tecinco API calls inside
  `migrateProdutos`/`migrateClientes`/`migrateNotasFiscais`, not the whole
  job — the `waitForQueueToDrain` step must stay outside any such lock.

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

## Store (`src/modules/sales/stores/`)

- `Store` is **not** one row per physical branch — it's a small, fixed
  taxonomy of Bling sales-channel *types* (`tipo` from Bling's
  `/canais-venda/{id}`, e.g. `"LojaFisica"`, `"MercadoLivre"`), shared by
  every branch/channel of that same type. `name` (the `tipo` value) is the
  real identity the rest of the codebase keys off directly —
  `nfe-reconciler.queue.ts`'s `where: { name: "MercadoLivre" }`,
  `ALLOWED_STORE_NAME` (`nfe.queue.ts`/`cnpj.queue.ts`), the
  `where: { name: "Outros" }` fallback in `bling-api-fetch.queue.ts`/
  `invoice-xml.ts`, and `Integration.allowed_channels`. `id_store_system` is
  only a fast-lookup cache for one specific Bling channel id already known
  to resolve to that bucket — not a real per-row identity, and not unique.
- **Fixed this session — ~20 duplicate `Store` rows all named
  `"LojaFisica"` in production.** Root cause: `BlingOrderService` (both
  `createOrderFromBling` and `updateOrderFromBling`, identical code
  duplicated in each) resolved the channel's `Store` via a plain
  check-then-create (`findOne({where:{name: tipo}})` then `create(...)` if
  not found) with **no DB unique constraint on `name`** — under concurrent
  webhook processing for orders from different physical branches that
  share the same Bling `tipo`, multiple requests could all pass the
  `findOne` check before any of them committed, each creating its own row.
  **Fixed**: both call sites now go through one shared private
  `BlingOrderService.resolveStore(lojaId)`, which calls
  `storeService.findOrCreateByName(tipo, idStoreSystem)` —
  `StoreRepository.findOrCreateByName` uses Sequelize's `findOrCreate` on
  `name`, made race-safe by a new unique index (migration
  `m276-dedupe-stores-and-unique-name.js`). That migration also merges the
  pre-existing duplicates: picks the oldest row per `name` as canonical,
  reassigns `orders.store_id`/`invoices.store_id`/
  `sales_order_snapshots.store_id`/`sales_order_item_snapshots.store_id`
  from the duplicates to it (plain UPDATE, none of those tables have a
  unique constraint on `store_id`), and — since
  `daily_sales_store_facts` has `UNIQUE(fact_date, unit_business_id,
  store_id)` and its metric columns include percentages
  (`markup_pct`/`contribution_pct`) that can't be arithmetically merged —
  just deletes the fact rows pinned to a duplicate `store_id` instead of
  reassigning them, since that table is a derived snapshot
  (`upsertDailySalesStoreFacts`) that regenerates from `orders`/
  `sales_order_snapshots`, which this same migration already fixed. This
  does **not** retroactively recompute historical daily-sales-store facts
  already recorded under the wrong `store_id` — if exact historical
  reporting matters, rerun the snapshot/fact recompute after the migration.
  As always, **the user runs this migration themselves.**

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
