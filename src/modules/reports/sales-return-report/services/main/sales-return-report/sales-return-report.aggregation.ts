import {
  divScaled,
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

/** a / b em %, 2 casas; 0 quando b = 0. */
function percent(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return toNumber(rescale(divScaled(part * 100n, total), 4, 2) * 100n);
}

/** Agrupa por nota de devolução; movimento sem nota achada fica sozinho. */
const returnKey = (line: SalesReturnLineRow): string =>
  line.return_invoice_id ?? `movement:${line.movement_id}`;

interface ReturnInvoiceTotals {
  totalValue: bigint;
  netValue: bigint;
  totalCost: bigint;
  profit: bigint;
  quantity: bigint;
}

/** Totais por nota de devolução, repetidos em cada linha (order_* e volumes do layout do faturado). */
function totalsByReturnInvoice(lines: SalesReturnLineRow[]): Map<string, ReturnInvoiceTotals> {
  const totals = new Map<string, ReturnInvoiceTotals>();
  for (const line of lines) {
    const current = totals.get(returnKey(line)) ?? {
      totalValue: 0n,
      netValue: 0n,
      totalCost: 0n,
      profit: 0n,
      quantity: 0n,
    };
    current.totalValue += scaled(line.total_value);
    current.netValue += scaled(line.net_value);
    current.totalCost += scaled(line.total_cost);
    current.profit += scaled(line.contribution_value);
    current.quantity += scaled(line.quantity);
    totals.set(returnKey(line), current);
  }
  return totals;
}

/** Uma linha por movimento de devolução; custo unitário = custo proporcional / qtd devolvida. */
export function buildReportRows(lines: SalesReturnLineRow[]): SalesReturnReportRow[] {
  const totals = totalsByReturnInvoice(lines);

  return lines.map((line) => {
    const invoiceTotals = totals.get(returnKey(line))!;
    const quantity = scaled(line.quantity);
    const itemTotalCost = scaled(line.total_cost);
    let unitCost = 0n;
    if (quantity !== 0n) unitCost = divScaled(itemTotalCost, quantity);

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
      invoice_number: line.sale_invoice_number,
      brand: line.brand_name,
      product: line.product_name ?? line.description,
      sku: line.sku,
      quantity: toNumber(quantity),
      total_value: toMoney(scaled(line.total_value)),
      net_value: toNumber(scaled(line.net_value)),
      unit_cost: toNumber(unitCost),
      item_total_cost: toNumber(itemTotalCost),
      order_total_value: toMoney(invoiceTotals.totalValue),
      order_net_value: toNumber(invoiceTotals.netValue),
      order_total_cost: toNumber(invoiceTotals.totalCost),
      profit: toNumber(scaled(line.contribution_value)),
      order_profit: toNumber(invoiceTotals.profit),
      volumes: toNumber(invoiceTotals.quantity),
      has_price: line.has_price,
      has_sale_item: line.has_sale_item,
    };
  });
}

/** Resumo somado das linhas (BigInt); receita = preço Bling × qtd (como o stock flow), demais valores proporcionais da venda. */
export function buildSummary(lines: SalesReturnLineRow[]): SalesReturnReportSummary {
  const sum = (pick: (line: SalesReturnLineRow) => DecimalValue): bigint =>
    lines.reduce((total, line) => total + scaled(pick(line)), 0n);

  const returnsCount = new Set(lines.map(returnKey)).size;
  const quantity = sum((line) => line.quantity);
  const grossRevenue = sum((line) => line.total_value);
  const totalCost = sum((line) => line.total_cost);
  const contribution = sum((line) => line.contribution_value);

  let averageTicket = 0n;
  if (returnsCount > 0) averageTicket = divScaled(grossRevenue, toScaled(returnsCount)!);

  return {
    orders_count: returnsCount,
    items_quantity: toNumber(quantity),
    total_volumes: toNumber(quantity),
    gross_revenue: toMoney(grossRevenue),
    total_discount: toNumber(sum((line) => line.discount_value)),
    total_net_value: toNumber(sum((line) => line.net_value)),
    total_marketplace_fees: toNumber(sum((line) => line.tax_commission)),
    total_freight: toNumber(sum((line) => line.freight_cost)),
    total_taxes: toNumber(sum((line) => line.computed_icms_value)),
    total_commission: toNumber(sum((line) => line.commission_value)),
    total_cost: toNumber(totalCost),
    total_supplier_discount: toNumber(sum((line) => line.supplier_discount_value)),
    contribution_value: toNumber(contribution),
    contribution_pct: percent(contribution, grossRevenue),
    markup_pct: percent(grossRevenue - totalCost, totalCost),
    average_ticket: toMoney(averageTicket),
    lines_without_sale_item: lines.filter((line) => !line.has_sale_item).length,
    lines_without_price: lines.filter((line) => !line.has_price).length,
  };
}
