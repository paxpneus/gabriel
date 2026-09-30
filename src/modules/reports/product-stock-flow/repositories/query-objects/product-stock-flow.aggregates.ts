import { FindAttributeOptions, fn, col } from "sequelize";
import { APP_TIMEZONE } from "../../../../../shared/utils/normalizers/date";
import { monthBucketLiteral } from "../../../../../shared/query/sequelize-helpers/month-bucket";
import {
  missingNetAmountCount,
  missingUnitPriceCount,
  outputValueSum,
} from "../../../../../shared/query/query-objects/stock-movements/stock-movement.attributes";

const MONTH_ATTRIBUTE: [ReturnType<typeof monthBucketLiteral>, string] = [
  monthBucketLiteral("movement_date", APP_TIMEZONE, "StockMovement"),
  "month",
];

/** Colunas agregadas por (mês, produto) das entradas. */
export function inputAggregateAttributes(): FindAttributeOptions {
  return [
    MONTH_ATTRIBUTE,
    "product_id",
    [fn("SUM", col("movement_quantity")), "total_input_quantity"],
    [fn("SUM", col("net_total_amount")), "total_input_value"],
    [missingNetAmountCount(), "inputs_without_net_amount"],
  ];
}

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

export const PRODUCT_STOCK_FLOW_GROUP = ["month", "product_id"];
