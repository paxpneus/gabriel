import {
  formatScaled,
  rescale,
  toScaled,
  DECIMAL_SCALE,
} from "../../../../../../shared/utils/normalizers/decimal";
import { toTz } from "../../../../../../shared/utils/normalizers/date";
import {
  ProductStockFlowInputRow,
  ProductStockFlowOutputRow,
  ProductStockFlowProduct,
  ProductStockFlowReturnRow,
  ProductStockFlowReport,
  ProductStockFlowSummary,
} from "../../../models/product-stock-flow.types";

export interface ProductInfo {
  name: string | null;
  sku: string | null;
}

interface Accumulator {
  inputQuantity: bigint;
  inputValue: bigint;
  outputQuantity: bigint;
  outputValue: bigint;
  returnQuantity: bigint;
  returnValue: bigint;
}

const MONEY_SCALE = 2;

function emptyAccumulator(): Accumulator {
  return {
    inputQuantity: 0n,
    inputValue: 0n,
    outputQuantity: 0n,
    outputValue: 0n,
    returnQuantity: 0n,
    returnValue: 0n,
  };
}

function add(target: Accumulator, source: Accumulator): void {
  target.inputQuantity += source.inputQuantity;
  target.inputValue += source.inputValue;
  target.outputQuantity += source.outputQuantity;
  target.outputValue += source.outputValue;
  target.returnQuantity += source.returnQuantity;
  target.returnValue += source.returnValue;
}

function quantityToNumber(value: bigint): number {
  return Number(formatScaled(value, DECIMAL_SCALE));
}

// Dinheiro sai com 2 casas, arredondado só no final (soma exata em BigInt).
function moneyToNumber(value: bigint): number {
  return Number(formatScaled(rescale(value, DECIMAL_SCALE, MONEY_SCALE), MONEY_SCALE));
}

function isEmpty(acc: Accumulator): boolean {
  return (
    acc.inputQuantity === 0n &&
    acc.inputValue === 0n &&
    acc.outputQuantity === 0n &&
    acc.outputValue === 0n &&
    acc.returnQuantity === 0n &&
    acc.returnValue === 0n
  );
}

function toProduct(
  productId: string,
  acc: Accumulator,
  info: ProductInfo | undefined,
): ProductStockFlowProduct {
  return {
    product_id: productId,
    product_name: info?.name ?? null,
    sku: info?.sku ?? null,
    total_input_quantity: quantityToNumber(acc.inputQuantity),
    total_input_value: moneyToNumber(acc.inputValue),
    total_output_quantity: quantityToNumber(acc.outputQuantity),
    total_output_value: moneyToNumber(acc.outputValue),
    total_return_quantity: quantityToNumber(acc.returnQuantity),
    total_return_value: moneyToNumber(acc.returnValue),
  };
}

function sortProducts(products: ProductStockFlowProduct[]): ProductStockFlowProduct[] {
  return products.sort((a, b) => {
    if (a.product_name === null && b.product_name !== null) return 1;
    if (a.product_name !== null && b.product_name === null) return -1;
    const byName = (a.product_name ?? "").localeCompare(b.product_name ?? "", "pt-BR");
    return byName || a.product_id.localeCompare(b.product_id);
  });
}

/** Meses "YYYY-MM" do range no timezone da aplicação, do mais recente pro mais antigo. */
export function listMonthsDescending(startDate: string, endDate: string): string[] {
  const last = toTz(endDate).startOf("month");
  const months: string[] = [];
  let cursor = toTz(startDate).startOf("month");

  while (!cursor.isAfter(last)) {
    months.push(cursor.format("YYYY-MM"));
    cursor = cursor.add(1, "month");
  }

  return months.reverse();
}

export interface AggregatedFlow {
  months: { month: string; products: ProductStockFlowProduct[] }[];
  consolidated: ProductStockFlowProduct[];
  summary: ProductStockFlowSummary;
  warnings: ProductStockFlowReport["warnings"];
}

/**
 * Junta as agregações de entrada/saída/devolução (mês × produto) em meses,
 * consolidado e summary — tudo em memória, sem nova consulta. Devolução tem
 * colunas próprias e abate a saída (qty e valor da NF); não entra nas entradas.
 */
export function aggregateProductStockFlow(
  inputs: ProductStockFlowInputRow[],
  outputs: ProductStockFlowOutputRow[],
  returns: ProductStockFlowReturnRow[],
  productInfo: Map<string, ProductInfo>,
  months: string[],
): AggregatedFlow {
  const byMonth = new Map<string, Map<string, Accumulator>>(
    months.map((month) => [month, new Map()]),
  );

  const accumulatorFor = (month: string, productId: string): Accumulator => {
    const monthMap = byMonth.get(month) ?? new Map<string, Accumulator>();
    byMonth.set(month, monthMap);
    const acc = monthMap.get(productId) ?? emptyAccumulator();
    monthMap.set(productId, acc);
    return acc;
  };

  let outputsWithoutPrice = 0;
  let inputsWithoutNetAmount = 0;
  let returnsWithoutPrice = 0;

  for (const row of inputs) {
    const acc = accumulatorFor(row.month, row.product_id);
    acc.inputQuantity += toScaled(row.total_input_quantity) ?? 0n;
    acc.inputValue += toScaled(row.total_input_value) ?? 0n;
    inputsWithoutNetAmount += Number(row.inputs_without_net_amount ?? 0);
  }

  for (const row of outputs) {
    const acc = accumulatorFor(row.month, row.product_id);
    acc.outputQuantity += toScaled(row.total_output_quantity) ?? 0n;
    acc.outputValue += toScaled(row.total_output_value) ?? 0n;
    outputsWithoutPrice += Number(row.outputs_without_price ?? 0);
  }

  for (const row of returns) {
    const acc = accumulatorFor(row.month, row.product_id);
    const quantity = toScaled(row.total_return_quantity) ?? 0n;
    const value = toScaled(row.total_return_value) ?? 0n;
    acc.returnQuantity += quantity;
    acc.returnValue += value;
    acc.outputQuantity -= quantity;
    acc.outputValue -= value;
    returnsWithoutPrice += Number(row.returns_without_price ?? 0);
  }

  const consolidated = new Map<string, Accumulator>();
  const summary = emptyAccumulator();

  const orderedMonths = [...byMonth.keys()].sort().reverse();
  const monthBlocks = orderedMonths.map((month) => {
    const monthMap = byMonth.get(month)!;
    const products: ProductStockFlowProduct[] = [];

    for (const [productId, acc] of monthMap) {
      // Produto zerado no mês não entra nesse mês (nem no consolidado por causa dele).
      if (isEmpty(acc)) continue;
      products.push(toProduct(productId, acc, productInfo.get(productId)));

      const total = consolidated.get(productId) ?? emptyAccumulator();
      add(total, acc);
      consolidated.set(productId, total);
      add(summary, acc);
    }

    return { month, products: sortProducts(products) };
  });

  return {
    months: monthBlocks,
    consolidated: sortProducts(
      [...consolidated]
        .filter(([, acc]) => !isEmpty(acc))
        .map(([productId, acc]) =>
          toProduct(productId, acc, productInfo.get(productId)),
        ),
    ),
    summary: {
      total_input_quantity: quantityToNumber(summary.inputQuantity),
      total_output_quantity: quantityToNumber(summary.outputQuantity),
      total_return_quantity: quantityToNumber(summary.returnQuantity),
      total_input_value: moneyToNumber(summary.inputValue),
      total_output_value: moneyToNumber(summary.outputValue),
      total_return_value: moneyToNumber(summary.returnValue),
    },
    warnings: {
      outputs_without_price: outputsWithoutPrice,
      inputs_without_net_amount: inputsWithoutNetAmount,
      returns_without_price: returnsWithoutPrice,
    },
  };
}
