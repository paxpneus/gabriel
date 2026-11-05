import { FindAttributeOptions, fn, col } from "sequelize";
import { APP_TIMEZONE } from "../../../../../shared/utils/normalizers/date";
import { monthBucketLiteral } from "../../../../../shared/query/sequelize-helpers/month-bucket";
import {
  missingUnitPriceCount,
  outputValueSum,
} from "../../../../../shared/query/query-objects/stock-movements/stock-movement.attributes";

const MONTH_ATTRIBUTE: [ReturnType<typeof monthBucketLiteral>, string] = [
  monthBucketLiteral("movement_date", APP_TIMEZONE, "StockMovement"),
  "month",
];

/** Colunas agregadas por (mês, produto) das saídas. */
export function outputAggregateAttributes(): FindAttributeOptions {
  return [
    MONTH_ATTRIBUTE,
    "product_id",
    [fn("SUM", col("movement_quantity")), "total_output_quantity"],
    [outputValueSum("StockMovement"), "total_output_value"],
    [missingUnitPriceCount("StockMovement"), "outputs_without_price"],
  ];
}

/** Devoluções por (mês, produto): quantidade e valor da NF de devolução. */
export function returnAggregateAttributes(): FindAttributeOptions {
  return [
    MONTH_ATTRIBUTE,
    "product_id",
    [fn("SUM", col("movement_quantity")), "total_return_quantity"],
    [outputValueSum("StockMovement"), "total_return_value"],
    [missingUnitPriceCount("StockMovement"), "returns_without_price"],
  ];
}

export const PRODUCT_STOCK_FLOW_GROUP = ["month", "product_id"];
