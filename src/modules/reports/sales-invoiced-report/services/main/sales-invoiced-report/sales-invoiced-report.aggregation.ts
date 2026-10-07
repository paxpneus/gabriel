import {
  formatScaled,
  mulScaled,
  toScaled,
} from "../../../../../../shared/utils/normalizers/decimal";
import {
  SalesInvoicedItemRow,
  SalesInvoicedReportRow,
  SalesInvoicedReportSummary,
  SalesInvoicedTotalsRow,
} from "../../../models/sales-invoiced-report.types";

type DecimalValue = string | number | null | undefined;

const toNumber = (value: DecimalValue): number =>
  value === null || value === undefined ? 0 : Number(value);

/** Volumes por pedido: total_expected da nota; sem nota, Σ quantity × kit_multiplier dos itens. */
export function computeOrderVolumes(
  rows: SalesInvoicedItemRow[],
): Map<string, number> {
  const unitsByOrder = new Map<string, bigint>();
  const invoiceVolumes = new Map<string, number>();

  for (const row of rows) {
    const { order_id, invoice } = row.orderSnapshot;
    if (invoice?.id) {
      invoiceVolumes.set(order_id, toNumber(invoice.total_expected));
      continue;
    }
    const units = mulScaled(
      toScaled(row.quantity) ?? 0n,
      toScaled(row.kit_multiplier) ?? toScaled(1)!,
    );
    unitsByOrder.set(order_id, (unitsByOrder.get(order_id) ?? 0n) + units);
  }

  const volumes = new Map<string, number>(invoiceVolumes);
  for (const [orderId, units] of unitsByOrder) {
    if (!volumes.has(orderId)) volumes.set(orderId, Number(formatScaled(units)));
  }
  return volumes;
}

export function buildReportRows(
  rows: SalesInvoicedItemRow[],
  volumesByOrder: Map<string, number>,
): SalesInvoicedReportRow[] {
  return rows.map((row) => {
    const order = row.orderSnapshot;
    return {
      order_id: order.order_id,
      store_name: order.unitBusiness?.name ?? null,
      order_date: order.order_date,
      order_number: order.order_number_system,
      seller_name: order.seller?.name ?? null,
      invoice_number: order.invoice?.number_system ?? null,
      brand: row.product?.brandRegister?.name ?? null,
      product: row.product?.name ?? row.description,
      sku: row.sku,
      quantity: toNumber(row.quantity),
      total_value: toNumber(row.net_total),
      net_value: toNumber(row.net_value),
      unit_cost: toNumber(row.average_cost_snapshot),
      item_total_cost: toNumber(row.total_cost_snapshot),
      order_total_value: toNumber(order.total_products),
      order_net_value: toNumber(order.net_value),
      order_total_cost: toNumber(order.total_cost),
      profit: toNumber(row.contribution_value),
      order_profit: toNumber(order.contribution_value),
      volumes: volumesByOrder.get(order.order_id) ?? 0,
    };
  });
}

export function buildSummary(
  totals: SalesInvoicedTotalsRow | null,
  volumesByOrder: Map<string, number>,
): SalesInvoicedReportSummary {
  let totalVolumes = 0n;
  for (const volumes of volumesByOrder.values()) {
    totalVolumes += toScaled(volumes) ?? 0n;
  }

  return {
    orders_count: toNumber(totals?.orders_count),
    items_quantity: toNumber(totals?.items_quantity),
    total_volumes: Number(formatScaled(totalVolumes)),
    gross_revenue: toNumber(totals?.gross_revenue),
    total_discount: toNumber(totals?.total_discount),
    total_net_value: toNumber(totals?.total_net_value),
    total_marketplace_fees: toNumber(totals?.total_marketplace_fees),
    total_freight: toNumber(totals?.total_freight),
    total_taxes: toNumber(totals?.total_taxes),
    total_commission: toNumber(totals?.total_commission),
    total_cost: toNumber(totals?.total_cost),
    total_supplier_discount: toNumber(totals?.total_supplier_discount),
    contribution_value: toNumber(totals?.contribution_value),
    contribution_pct: toNumber(totals?.contribution_pct),
    markup_pct: toNumber(totals?.markup_pct),
    average_ticket: toNumber(totals?.average_ticket),
  };
}
