# Reports module

- `sales-report.repository.ts` — raw SQL building the daily sales-report snapshot. Per the snapshot-is-source-of-truth pattern, values are computed once in `upsertSnapshots` and read from the snapshot table by everyone else. `gtin` column reads `pc.gtin` directly (no `gtin_package` fallback, since `m265` — see `.claude/entities/product/index.md`).
- `SalesReportQueue.applySupplierDiscounts` writes `SalesOrderItemSnapshot.supplier_discount_value`/`.supplier_discount_rule_id` hourly — see `.claude/entities/invoice/supplier-discount/report-value.md` for how the Invoices module reads this.
- See `.claude/entities/order/index.md` for the `orders.internal_status` vs. `sales_order_snapshots.status_snapshot` divergence — `status_snapshot` is computed in this repository's `upsertSnapshots`.
