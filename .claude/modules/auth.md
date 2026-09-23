# Auth / tenant-scoping module

Cross-cutting tenant/auth scoping model. Read before touching auth/scoping on any controller, or investigating a suspected cross-store/cross-integration data leak.

## Tenant-scoping model

- `getUserContext(req)` (`src/shared/query/get-logged-user.ts`) — derives `{ userId, unitBusinessId }` from the authenticated user. Standard way a controller should derive tenant scope.
- `resolveIntegrationsIdForUnitBusiness(unitBusinessId, transaction?)` / `isProductOwnedByIntegration(product, integrationsId)` (`src/modules/handlers/tecinco/queues/helpers/product.helpers.ts`) — shared helpers for integration-level scoping.
- `BaseController`'s generic CRUD routes (`GET /`, `GET /:id`, `POST /`, `POST /bulk`, `PUT /:id`, `PUT /bulk`, `DELETE /:id`, `DELETE /bulk` — no PATCH route exists) run **completely unscoped** by tenant (`unit_business_id`/`integrations_id`) unless the subclass explicitly overrides the action. Root cause behind most tenant-leak bugs in this codebase.
- `userPermissions` middleware (`src/middlewares/user-permissions.ts`) only checks role-based CRUD permission per entity type — never row-level/tenant scoping, so it does not mitigate the leak above.
- `BaseRepository.findById`/`.update`/`.delete` don't take a forced tenant where-clause — ownership must be checked manually (fetch, compare, 404 on mismatch) before calling them in a scoped `show`/`update`/`destroy`. `BaseService.paginate(params, extraOptions?, forcedWhere?)` — `forcedWhere` is the mechanism for scoping `index` by tenant without touching user-supplied filters.
- `USER_TYPES` (`src/shared/constants/user-types.ts`) also includes `developer` (`DEVELOPER_USER_TYPE`) alongside `admin` — the only two entries with `modules: "*"` (full access). Distinct from the `role`/`roles` table used by `userPermissions` below; `user_config.type` (`UserType`) is used for menu/module visibility and as the notification-targeting key in `EventService.notifyByRoles` (e.g. `integration_errors` notifies `developer` users — see `../entities/integration-error.md`).
- **Different failure class, same middleware**: `userPermissions` denies by default unless the user's role has a matching `entity` in its `permissions` array — and that entity must first exist in the grantable-permission tree (`src/shared/constants/user-types.ts`, `USER_TYPES`). If a controller is wired up correctly (`authenticate` + `userPermissions`) but its entity id was never added to `USER_TYPES`, no admin can ever grant a non-admin role access through the role-editing UI — every request is denied regardless of role config, which looks identical to a scoping bug from the outside but has a completely different fix (add the entity to `USER_TYPES`, not touch the controller). Confirmed and fixed for the Orders module (`orders` entity missing from "Operador"'s tree entirely) — see `../entities/order/index.md`. Worth checking `USER_TYPES` first if a user reports "I gave them the role but they still can't access X" for a module that otherwise looks properly wired.

## Known tenant-scoping status by controller

**Fixed:**
- `pdv-sales-request.controller.ts` (módulo PDV Management) — não usa o RBAC genérico (`authenticate`/`userPermissions`); usa middleware próprio `pdvAccess()` (`src/modules/sales/pdv-management/pdv-access/pdv-access.middleware.ts`) que aceita login (loja atual + permissão de role) OU link/token sem login (derivado por HMAC, sem tabela) — ver `.claude/entities/pdv-sales-request/index.md` § "Rotas e auth". Antes ficava com zero proteção em toda rota.
- `supplier-mapping.controller.ts` — all actions scope by `integrations_id` derived from the logged user; `show`/`update`/`destroy` verify ownership (404 on mismatch); `update`/`bulkUpdate` strip any client-supplied `integrations_id`.
- `product_config.controller.ts` — previously **no auth at all** on any route; now `authenticate` + `userPermissions` on all actions, same ownership-scoping pattern keyed on `unit_business_id`.
- `batch.repository.ts` (expedition) — `ProductConfig` include inside `batchInvoicesInclude` was missing `where: { unit_business_id }`, leaking another store's `sku`/`gtin`/`price` on `/api/batch/full/get`. Fixed.

**NOT fixed — CRITICAL (no auth at all):**
- `src/modules/inventory/stock/stock/stock.controller.ts` — no `middlewaresFor()`; any unauthenticated request can read/write/delete stock of any store.
- `src/modules/integrations/integration-mapping/integration-mapping.controller.ts` — `index`/`show`/`create`/`bulkCreate` have no `middlewaresFor()` (`update`/`destroy`/`bulkUpdate`/`bulkDestroy` always return 405, so those four are safe by being disabled, not scoped).

**NOT fixed — HIGH (authenticated, but not scoped by tenant):**
- `src/modules/integrations/config_tokens/config_tokens.controller.ts` — worst of this group: stores `access_token`/`refresh_token`/`client_secret`/`api_key` per `integrations_id`; any user with generic "config_tokens" role permission can read/overwrite any integration's credentials.
- `src/modules/warehouse/fiscal/invoices/invoice/invoice.controller.ts` — `show`/`destroy`/`create` unscoped; `index`/`update`/`getFullInvoice` accept a client-supplied `?unitBusinessId=` that overrides the logged user's own store; `getDanfeBatch`/`downloadXmlBatch` fetch by id list with no store filter (leaks DANFE/XML/CNPJ across stores).
- `src/modules/inventory/stock/stock-movements/stock-movements.controller.ts` — CRUD base unscoped, and custom endpoints (`getHistory`, `sync`, `createManualAdjustment`, etc.) trust a client-supplied `unit_business_id`.
- Same generic-CRUD-unscoped pattern in: `user.controller.ts`, `user_unit_business.controller.ts`, `unit-business-config.controller.ts`, `inventory-batch.controller.ts`, `unmapped-invoice-product.controller.ts`, `contacts.controller.ts`, `order_items.controller.ts`, `orders.controller.ts`, `batch.controller.ts` (expedition), `operation-comment.controller.ts`, `transporter.controller.ts`.

**LOW / possible false positive:**
- `unit-business.controller.ts` — `index`/`show` aren't scoped to the user's own store(s); `update`/`destroy` only check role. May be intentional (it's the tenant list itself) — needs a product decision, not an obvious bug fix.
