import { FindAttributeOptions, OrderItem } from "sequelize";
import { totalExpectedLiteral } from "../../../../warehouse/fiscal/invoices/invoice/helpers/totals";

export const ORDER_SNAPSHOT_INCLUDE_ALIAS = "orderSnapshot";
/** Alias que o Sequelize dá à nota incluída dentro de orderSnapshot. */
export const INVOICE_INCLUDE_ALIAS = `${ORDER_SNAPSHOT_INCLUDE_ALIAS}->invoice`;

/** Colunas do item (sales_order_item_snapshots) usadas na linha. */
export const ITEM_ROW_ATTRIBUTES = [
  "order_item_id",
  "sku",
  "description",
  "quantity",
  "kit_multiplier",
  "net_total",
  "net_value",
  "average_cost_snapshot",
  "total_cost_snapshot",
  "contribution_value",
];

/** Colunas do pedido (sales_order_snapshots) repetidas em cada linha. */
export const ORDER_ROW_ATTRIBUTES = [
  "order_id",
  "order_number_system",
  "order_date",
  "total_products",
  "net_value",
  "total_cost",
  "contribution_value",
];

export const UNIT_BUSINESS_ROW_ATTRIBUTES = ["name"];
// total_expected é VIRTUAL no model (sumiria do SELECT); calcula pelos invoice_items, já em unidades reais (kit expandido no import).
export function invoiceRowAttributes(
  invoiceAlias: string = INVOICE_INCLUDE_ALIAS,
): FindAttributeOptions {
  return [
    "id",
    "number_system",
    [totalExpectedLiteral(invoiceAlias), "total_expected"],
  ];
}
export const SELLER_ROW_ATTRIBUTES = ["name"];
export const PRODUCT_ROW_ATTRIBUTES = ["name"];
export const BRAND_ROW_ATTRIBUTES = ["name"];

export const ROW_ORDER: OrderItem[] = [
  ["orderSnapshot", "order_date", "ASC"],
  ["orderSnapshot", "order_number_system", "ASC"],
];
