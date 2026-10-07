import { FindAttributeOptions, Sequelize } from "sequelize";
import {
  coalesceZero,
  markupPct,
  percentOf,
  safeDivide,
} from "../../../../../shared/query/sequelize-helpers/arithmetic";

export const TOTALS_SNAPSHOT_ALIAS = "SalesOrderSnapshot";

/** Totais do relatório sobre sales_order_snapshots (nível pedido, mesma base do general do sales report). */
export function totalsAggregateAttributes(
  alias: string = TOTALS_SNAPSHOT_ALIAS,
): FindAttributeOptions {
  const sum = (column: string) => coalesceZero(`SUM("${alias}"."${column}")`);
  const ordersCount = `COUNT(*)`;

  return [
    [Sequelize.literal(`${ordersCount}::integer`), "orders_count"],
    [Sequelize.literal(sum("items_quantity")), "items_quantity"],
    [Sequelize.literal(sum("total_products")), "gross_revenue"],
    [Sequelize.literal(sum("discount_value")), "total_discount"],
    [Sequelize.literal(sum("net_value")), "total_net_value"],
    [Sequelize.literal(sum("tax_commission")), "total_marketplace_fees"],
    [Sequelize.literal(sum("freight_cost")), "total_freight"],
    [Sequelize.literal(sum("computed_icms_value")), "total_taxes"],
    [Sequelize.literal(sum("total_commission")), "total_commission"],
    [Sequelize.literal(sum("total_cost")), "total_cost"],
    [Sequelize.literal(sum("total_supplier_discount")), "total_supplier_discount"],
    [Sequelize.literal(sum("contribution_value")), "contribution_value"],
    [
      Sequelize.literal(percentOf(sum("contribution_value"), sum("total_products"))),
      "contribution_pct",
    ],
    [
      Sequelize.literal(markupPct(sum("total_products"), sum("total_cost"))),
      "markup_pct",
    ],
    [
      Sequelize.literal(safeDivide(sum("total_products"), ordersCount)),
      "average_ticket",
    ],
  ];
}
