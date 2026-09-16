# `rim`/`supplier_discount` invoice filters

Both in `invoice/helpers/custom-filters.ts`, wired into `InvoiceService.queryConfig.customFields`/`listInvoices`.

- `productRimWhere(rimIds: string[])` — `rim` filter: notas com algum item cujo `Product.rim_id` está no array informado (OR entre os aros). Plain `EXISTS` over `invoice_items`/`products`, no KIT-component resolution (mirrors the pre-existing `brand` customField's directness, not the discount engine below).
- `supplierDiscountMatchWhere(ruleIds: string[])` — `supplier_discount` filter: pass `SupplierDiscountRule` ids, get invoices with some item that **actually received** the discount from one of them.

## Revised — the first version was wrong

Originally re-checked the rule's *scope* (brand/rim/measure wildcard-if-empty, `unit_business_id`/date window, same "candidate" logic as `matchBatch`) against `Order.date`/`Order.unit_business_id` — a "would this item qualify" check, not "did this item get the discount." These differ: `resolveForItems` also requires the pooled quantity (same order + brand + rim + measure + store) to reach the rule's `quantity_step` before granting anything. Confirmed in prod: a single-tire sale (`quantity_step=2`) showed up with `supplier_discount_value: 0` — scope matched, but 1 unit never crosses "a cada 2." User's call: "não faz sentido pegar nota onde não bate o desconto" — show only notes where the discount was actually granted.

**Fixed** by reading `sales_order_item_snapshots.supplier_discount_rule_id` directly (`= ANY(ruleIds)`) — the field `resolveForItems` itself writes after deciding quantity eligibility — instead of recomputing eligibility. Same KIT-vs-component correlation problem as `report-value.md`'s `buildSupplierDiscountLookup`: the snapshot's `product_id` is the KIT sold on the order, not the component(s) the NF-e actually lists, so the `EXISTS` subquery's `LEFT JOIN kit_components` matches an invoice item either directly (`sois.product_id = ii.product_id`) or via its kit's component (`kc.product_component_id = ii.product_id`).

## Net effect

`supplier_discount` no longer needs `Order.date`/`Order.unit_business_id`, a rule's scope axes, or any DB read before building the `where` — joins `orders`/`sales_order_item_snapshots`/`kit_components` inline in one `Sequelize.literal` EXISTS, entirely from the `ruleIds` in the filter value. Now a **static, synchronous** entry in the constructor's `queryConfig.customFields`, like `rim` — no per-request `queryConfig` copy, no `supplierDiscountRuleService.findManyDetailedByIds` call for this filter (still used elsewhere, see `report-value.md`). `listInvoices` calls `this.repository.listInvoices(params, unitBusinessId, this.queryConfig)` directly again, same as before this feature existed.

Filter values are interpolated into raw SQL straight from the client (`?filters[supplier_discount][]=...`), unlike the rejected scope-based version (only touched ids already fetched from the DB) — `sqlUuidArrayLiteral` hardened accordingly: validates each value against a real UUID regex, silently drops anything that doesn't match, rather than only escaping quotes. `productRimWhere`'s `rimIds` (always client-supplied too) now goes through the same hardened helper.

Both `getInvoiceProductReport`/`getInvoiceSupplierReport` still keep their `Order` include (`as: "order"`, `id`/`date`/`unit_business_id`) — no longer needed by this filter after the rewrite, but still needed by `buildSupplierDiscountLookup` (`report-value.md`) for `invoice.order.id`.
