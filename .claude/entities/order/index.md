# Order entity (sales)

`src/modules/sales/orders/`

Split by subject:
- This file — base facts, auth, `internal_status`/`status_snapshot` divergence
- `status-sync.md` — `reason_cancelled`, `syncOrderInternalStatus`/`escalateToHumanVerificationIfStillPending`
- `summary-endpoints.md` — `GET /api/order/summary/...` repository logic

- `order_items.service.ts` — builds sales-detail rows joining `ProductConfig` (by `gtin` only, since `m265`) with integration-mapping data and seller external ids; feeds Tecinco-facing reporting.
- `orders.controller.ts`/`order_items.controller.ts` are in the HIGH unscoped-CRUD list — see `../../modules/auth.md`. Not fixed.
- **Fixed — `USER_TYPES` had no `orders` permission entity at all for the "Operador" role.** `src/shared/constants/user-types.ts` defines the tree of grantable permission entities an admin picks from when configuring a role; "Operador"'s "Vendas" group had `sales_invoice` but no entry for Orders itself. Since `userPermissions` middleware (`../../modules/auth.md`) denies by default unless the role's `permissions` array contains a matching `entity`, no admin could ever grant a non-admin role access to `orders.controller.ts`'s routes — every request from an Operador-based user was denied regardless of role config. **Fixed** by adding `{ id: "orders", label: "Pedidos de Venda" }` under "Operador" → "Vendas" (alongside `sales_invoice`).

## Confirmed production data-integrity gap, NOT fixed

`orders.internal_status` and `sales_order_snapshots.status_snapshot` are two independent status vocabularies for the same order that can genuinely disagree, and nothing reconciles them. `status_snapshot` is computed in `sales-report.repository.ts`'s `upsertSnapshots` as `COALESCE(iosm.normalized_status, o.actual_situation)` — derived from `orders.actual_situation` (raw Bling situação code) via `integration_order_status_mappings`, **not** from `internal_status`. `SalesReportQueue` re-upserts it hourly for any order touched since the last run, so it's a live column, not a frozen historical snapshot (despite a comment in `orders.service.ts` calling it "congelado").

Meanwhile several queues (`cnpj.queue.ts`, `mercado-livre-sync.queue.ts`, `nfe.queue.ts`, `nfe-reconciler.queue.ts`) advance `internal_status` *alone*, without ever touching `actual_situation` — so an order can sit with `internal_status=OPEN`/`WAITING_CHANNEL_VALIDATION` (still pending per the app's own fulfillment pipeline) while `status_snapshot` already shows a terminal Bling-side label like `"CANCELADO"`/`"ATENDIDO"`.

`OrderService.paginate()`'s `salesSnapshot?.status_snapshot ?? internal_status ?? null` precedence (the generic Orders listing) is unaffected/intentional for that screen, but any *new* code that filters by `internal_status` must display `internal_status`, not `status_snapshot`, for the same row, or it will self-contradict. **Not fixed at the root** — only worked around locally in `ship_to_define`'s detail endpoint (`summary-endpoints.md`) by displaying `internal_status` there instead of the snapshot.
