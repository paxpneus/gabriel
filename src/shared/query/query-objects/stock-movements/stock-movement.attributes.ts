import { Sequelize } from "sequelize";
import { Literal } from "sequelize/types/utils";

const DEFAULT_ALIAS = "StockMovement";

/** SUM(unit_price_invoice * movement_quantity); linhas sem preço não entram. */
export function outputValueSum(alias: string = DEFAULT_ALIAS): Literal {
  return Sequelize.literal(
    `COALESCE(SUM("${alias}"."unit_price_invoice" * "${alias}"."movement_quantity"), 0)`,
  );
}

/** Quantas linhas do grupo não têm unit_price_invoice. */
export function missingUnitPriceCount(alias: string = DEFAULT_ALIAS): Literal {
  return Sequelize.literal(
    `COUNT(*) FILTER (WHERE "${alias}"."unit_price_invoice" IS NULL)`,
  );
}

/** Quantas linhas do grupo não têm net_total_amount calculado. */
export function missingNetAmountCount(alias: string = DEFAULT_ALIAS): Literal {
  return Sequelize.literal(
    `COUNT(*) FILTER (WHERE "${alias}"."net_total_amount" IS NULL)`,
  );
}
