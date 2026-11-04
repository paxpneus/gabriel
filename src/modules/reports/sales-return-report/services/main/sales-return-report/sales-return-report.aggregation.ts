import {
  formatScaled,
  rescale,
  toScaled,
} from "../../../../../../shared/utils/normalizers/decimal";
import {
  SalesReturnLineRow,
  SalesReturnReportRow,
  SalesReturnReportSummary,
} from "../../../models/sales-return-report.types";

type DecimalValue = string | number | null | undefined;

const scaled = (value: DecimalValue): bigint => toScaled(value ?? null) ?? 0n;
const toNumber = (value: bigint): number => Number(formatScaled(value));
// Soma em 4 casas e arredonda só na saída, como o stock flow (preço Bling × qtd tem mais de 2 casas).
const toMoney = (value: bigint): number => toNumber(rescale(value, 4, 2) * 100n);

/** Agrupa por nota de devolução; movimento sem nota achada fica sozinho. */
const returnKey = (line: SalesReturnLineRow): string =>
  line.return_invoice_id ?? `movement:${line.movement_id}`;

/** Valor e quantidade por nota de devolução, repetidos em cada linha (order_total_value/volumes do layout do faturado). */
function totalsByReturnInvoice(
  lines: SalesReturnLineRow[],
): Map<string, { totalValue: bigint; quantity: bigint }> {
  const totals = new Map<string, { totalValue: bigint; quantity: bigint }>();
  for (const line of lines) {
    const current = totals.get(returnKey(line)) ?? { totalValue: 0n, quantity: 0n };
    current.totalValue += scaled(line.total_value);
    current.quantity += scaled(line.quantity);
    totals.set(returnKey(line), current);
  }
  return totals;
}

/** Uma linha por movimento de devolução. */
export function buildReportRows(lines: SalesReturnLineRow[]): SalesReturnReportRow[] {
  const totals = totalsByReturnInvoice(lines);

  return lines.map((line) => {
    const invoiceTotals = totals.get(returnKey(line))!;
    return {
      movement_id: line.movement_id,
      return_invoice_id: line.return_invoice_id,
      return_invoice_number: line.return_invoice_number,
      return_date: line.return_date,
      order_id: line.order_id,
      store_name: line.store_name,
      order_date: line.order_date,
      order_number: line.order_number_system,
      seller_name: line.seller_name,
      customer_name: line.customer_name,
      sales_channel: line.sales_channel,
      invoice_number: line.sale_invoice_number,
      brand: line.brand,
      product: line.product_name ?? line.description,
      sku: line.sku,
      quantity: toNumber(scaled(line.quantity)),
      total_value: toMoney(scaled(line.total_value)),
      order_total_value: toMoney(invoiceTotals.totalValue),
      volumes: toNumber(invoiceTotals.quantity),
      has_price: line.has_price,
    };
  });
}

/** Resumo somado das linhas (BigInt): nº de notas, quantidade e valor devolvidos. */
export function buildSummary(lines: SalesReturnLineRow[]): SalesReturnReportSummary {
  const sum = (pick: (line: SalesReturnLineRow) => DecimalValue): bigint =>
    lines.reduce((total, line) => total + scaled(pick(line)), 0n);
  const quantity = toNumber(sum((line) => line.quantity));

  return {
    orders_count: new Set(lines.map(returnKey)).size,
    items_quantity: quantity,
    total_volumes: quantity,
    gross_revenue: toMoney(sum((line) => line.total_value)),
    lines_without_price: lines.filter((line) => !line.has_price).length,
  };
}

/** Quantas notas dos movimentos não existem no sistema (movimento sem número conta pelo id). */
export function movementsWithoutInvoice(lines: SalesReturnLineRow[]): number {
  const keys = new Set<string>();
  for (const line of lines) {
    if (!line.return_invoice_id) keys.add(line.return_invoice_number ?? `movement:${line.movement_id}`);
  }
  return keys.size;
}
