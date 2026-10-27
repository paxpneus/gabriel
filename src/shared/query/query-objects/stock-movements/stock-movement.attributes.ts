import { Sequelize } from "sequelize";
import { Literal } from "sequelize/types/utils";
import sequelize from "../../../../config/sequelize";

const DEFAULT_ALIAS = "StockMovement";

/** SUM(unit_price_invoice * movement_quantity); linhas sem preço não entram. */
export function outputValueSum(alias: string = DEFAULT_ALIAS): Literal {
  const t = sequelize.getQueryInterface().quoteIdentifier(alias);
  return Sequelize.literal(
    `COALESCE(SUM(${t}."unit_price_invoice" * ${t}."movement_quantity"), 0)`,
  );
}

/** Quantas linhas do grupo não têm unit_price_invoice. */
export function missingUnitPriceCount(alias: string = DEFAULT_ALIAS): Literal {
  const t = sequelize.getQueryInterface().quoteIdentifier(alias);
  return Sequelize.literal(
    `COUNT(*) FILTER (WHERE ${t}."unit_price_invoice" IS NULL)`,
  );
}

/** Quantas linhas do grupo não têm net_total_amount calculado. */
export function missingNetAmountCount(alias: string = DEFAULT_ALIAS): Literal {
  const t = sequelize.getQueryInterface().quoteIdentifier(alias);
  return Sequelize.literal(
    `COUNT(*) FILTER (WHERE ${t}."net_total_amount" IS NULL)`,
  );
}
