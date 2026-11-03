import { SqlExpression } from "../../../../../shared/query/sequelize-helpers/arithmetic";

/** Coluna de saída → coluna de sales_order_item_snapshots levada proporcionalmente à qtd devolvida. */
export const PRORATED_SALE_ITEM_COLUMNS: Record<string, string> = {
  net_value: "net_value",
  total_cost: "total_cost_snapshot",
  contribution_value: "contribution_value",
  discount_value: "discount_value",
  tax_commission: "tax_commission_allocated",
  freight_cost: "freight_cost_allocated",
  computed_icms_value: "computed_icms_value_allocated",
  commission_value: "commission_value",
  supplier_discount_value: "supplier_discount_value",
};

/**
 * Fator = qtd devolvida / unidades vendidas do item (qtd × kit_multiplier: a NF lista o componente, o pedido o kit).
 * returnLineAlias = linha devolvida (coluna quantity); saleItemAlias = item do snapshot casado.
 */
export function returnFactorSql(
  returnLineAlias: string,
  saleItemAlias: string,
): SqlExpression {
  return `${returnLineAlias}.quantity / NULLIF(${saleItemAlias}.quantity * COALESCE(${saleItemAlias}.kit_multiplier, 1), 0)`;
}

/** SELECT dos valores do item vendido × fator (coluna "factor" do alias), arredondados em centavos; sem item casado = 0. */
export function proratedSaleItemColumnsSql(saleItemAlias: string): SqlExpression {
  return Object.entries(PRORATED_SALE_ITEM_COLUMNS)
    .map(
      ([output, column]) =>
        `COALESCE(ROUND(${saleItemAlias}.${column} * ${saleItemAlias}.factor, 2), 0) AS ${output}`,
    )
    .join(",\n        ");
}
