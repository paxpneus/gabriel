import {
  roundTo,
  SqlExpression,
  subtractAll,
} from "../../../../../shared/query/sequelize-helpers/arithmetic";

// Valor líquido = receita após desconto − taxa do marketplace − frete pago − ICMS calculado (ICMS+DIFAL) − comissão do vendedor.
export interface NetValueParts {
  netProducts: SqlExpression;
  marketplaceCommission: SqlExpression;
  freightPaid: SqlExpression;
  computedIcms: SqlExpression;
  sellerCommission: SqlExpression;
}

function netValueSql(parts: NetValueParts): SqlExpression {
  return roundTo(
    subtractAll(parts.netProducts, [
      parts.marketplaceCommission,
      parts.freightPaid,
      parts.computedIcms,
      parts.sellerCommission,
    ]),
  );
}

/** Item: commission_base já é o totalProdutos rateado menos o desconto rateado. */
export function itemNetValueSql(alias?: string): SqlExpression {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  return netValueSql({
    netProducts: col("commission_base"),
    marketplaceCommission: col("tax_commission_allocated"),
    freightPaid: col("freight_cost_allocated"),
    computedIcms: col("computed_icms_value_allocated"),
    sellerCommission: col("commission_value"),
  });
}

/** Pedido: sellerCommission vem como expressão porque o rollup lê de item_totals, não do snapshot. */
export function orderNetValueSql(
  snapshotAlias: string,
  sellerCommission: SqlExpression,
): SqlExpression {
  return netValueSql({
    netProducts: subtractAll(`${snapshotAlias}.total_products`, [
      `${snapshotAlias}.discount_value`,
    ]),
    marketplaceCommission: `${snapshotAlias}.tax_commission`,
    freightPaid: `${snapshotAlias}.freight_cost`,
    computedIcms: `${snapshotAlias}.computed_icms_value`,
    sellerCommission,
  });
}
