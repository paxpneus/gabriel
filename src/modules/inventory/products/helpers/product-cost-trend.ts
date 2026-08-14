import StockMovement from "../../stock/stock-movements/stock-movements.model";

export type AverageCostTrend = "INCREASED" | "DECREASED" | "UNCHANGED";

export function computeAverageCostTrend(
  entries: Pick<StockMovement, "resulting_average_cost">[],
): AverageCostTrend {
  const hasSecondEntry = entries.length > 1;
  if (!hasSecondEntry) return "UNCHANGED";

  const lastCost = Number(entries[0]?.resulting_average_cost ?? 0);
  const secondCost = Number(entries[1]?.resulting_average_cost ?? 0);
  const diff = lastCost - secondCost;

  if (diff > 0) return "INCREASED";
  if (diff < 0) return "DECREASED";
  return "UNCHANGED";
}

export function averageCostDifference(
  entries: Pick<StockMovement, "resulting_average_cost">[],
): number {
  if (entries.length <= 1) return 0;
  const lastCost = Number(entries[0]?.resulting_average_cost ?? 0);
  const secondCost = Number(entries[1]?.resulting_average_cost ?? 0);
  return lastCost - secondCost;
}