# Order entity (sales)

`src/modules/sales/orders/`

Split by subject:
- This file — base facts, auth, `internal_status`/`status_snapshot` divergence
- `status-sync.md` — `reason_cancelled`, `syncOrderInternalStatus`/`escalateToHumanVerificationIfStillPending`
- `summary-endpoints.md` — `GET /api/order/summary/...` repository logic

- `order_items.service.ts` — builds sales-detail rows joining `ProductConfig` (by `gtin` only, since `m265`) with integration-mapping data and seller external ids; feeds Tecinco-facing reporting.
- `orders.controller.ts`/`order_items.controller.ts` are in the HIGH unscoped-CRUD list — see `../../modules/auth.md`. Not fixed.
- **Fixed — `USER_TYPES` had no `orders` permission entity at all for the "Operador" role.** `src/shared/constants/user-types.ts` defines the tree of grantable permission entities an admin picks from when configuring a role; "Operador"'s "Vendas" group had `sales_invoice` but no entry for Orders itself. Since `userPermissions` middleware (`../../modules/auth.md`) denies by default unless the role's `permissions` array contains a matching `entity`, no admin could ever grant a non-admin role access to `orders.controller.ts`'s routes — every request from an Operador-based user was denied regardless of role config. **Fixed** by adding `{ id: "orders", label: "Pedidos de Venda" }` under "Operador" → "Vendas" (alongside `sales_invoice`).

## `internal_status` vs. `actual_situation`/`status_snapshot`, and `OrderService.paginate()`'s status resolution

`orders.internal_status` and `orders.actual_situation` are two independent status vocabularies for the same order that can genuinely disagree, and nothing reconciles them. `actual_situation` is the raw Bling situação id, written directly from Bling webhooks/sync. `sales_order_snapshots.status_snapshot` is a *derived* column, computed in `sales-report.repository.ts`'s `upsertSnapshots` as `COALESCE(iosm.normalized_status, o.actual_situation)` — i.e. also sourced from `actual_situation` via `integration_order_status_mappings`, **not** from `internal_status`. `SalesReportQueue` re-upserts it hourly for any order touched since the last run, so it's a live column, not a frozen historical snapshot.

Meanwhile several queues (`cnpj.queue.ts`, `mercado-livre-sync.queue.ts`, `nfe.queue.ts`, `nfe-reconciler.queue.ts`) advance `internal_status` *alone*, without ever touching `actual_situation` — so an order can sit with `internal_status=OPEN`/`WAITING_CHANNEL_VALIDATION` (still pending per the app's own fulfillment pipeline) while `actual_situation`/`status_snapshot` already shows a terminal Bling-side label like `"CANCELADO"`/`"ATENDIDO"`.

**`OrderService.paginate()` (generic Orders listing) no longer reads `sales_order_snapshots` at all.** It resolves `status` straight from `orders.actual_situation`, translated to a user-friendly label via `integration_order_status_mappings` (`integrationOrderStatusMappingService.findByIntegrations`, keyed by `integration_id:external_status_id` → `display_name`) — the same table `status_snapshot` itself is derived from, just queried live off `orders` instead of through the snapshot table. Falls back to the raw `actual_situation` code (never `internal_status`) when no mapping row exists for that integration/code. `filters[status]` keeps accepting `normalized_status` values (`"CANCELADO"`, `"ATENDIDO"`, ...) — `OrderService.resolveStatusFilter()` translates them to the matching `external_status_id`s before the query runs, so the actual `WHERE` is a plain `actual_situation IN (...)` on `orders`.

Any *new* code that filters by `internal_status` must still display `internal_status`, not `actual_situation`/`status_snapshot`, for the same row, or it will self-contradict — e.g. `ship_to_define`'s detail endpoint (`summary-endpoints.md`) displays `internal_status` because its filter is by `internal_status`.
