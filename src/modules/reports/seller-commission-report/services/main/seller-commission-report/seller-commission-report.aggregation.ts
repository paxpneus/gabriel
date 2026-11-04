import { formatScaled, toScaled } from "../../../../../../shared/utils/normalizers/decimal";
import {
  CommissionInvoiceRow,
  InvoiceWithoutMovementRow,
  SellerCommissionItemRow,
  SellerCommissionReportRow,
  SellerCommissionReportSummary,
  SellerCommissionReportWarnings,
  SellerCommissionWarningReason,
} from "../../../models/seller-commission-report.types";

type DecimalValue = string | number | null | undefined;

const scaled = (value: DecimalValue): bigint => toScaled(value ?? null) ?? 0n;
const toNumber = (value: bigint): number => Number(formatScaled(value));

/** Vendedor/gerente filtrados; ausente = todos. `unitBusinessIds` = lojas dos gerentes. */
export interface PeopleFilter {
  sellerIds?: string[];
  unitBusinessIds?: string[];
}

/** Motivo de a nota não entrar, na ordem da cadeia movimento → nota → pedido → seller report; null = entra. */
export function exclusionReason(row: CommissionInvoiceRow): SellerCommissionWarningReason | null {
  if (!row.invoice_id && !row.is_order_adjustment) return "movements_without_invoice";
  if (row.invoice_cancelled && row.has_return_invoice) return "cancelled_invoices_return_without_movement";
  if (row.invoice_cancelled) return "cancelled_invoices_without_return";
  if (!row.order_id) return "invoices_without_order";
  if (!row.has_seller) return "orders_without_seller";
  if (!row.snapshot_items) return "orders_not_in_seller_report";
  if (!row.has_cost_data) return "orders_missing_cost";
  if (!row.is_valid_sale) return "orders_not_completed";
  return null;
}

/** Pedido fora do vendedor/loja do gerente filtrado sai do relatório e dos avisos; sem pedido passa (não tem vendedor pra comparar). */
export function matchesPeopleFilter(
  order: { seller_id: string | null; unit_business_id: string | null },
  filter: PeopleFilter,
  hasOrder: boolean,
): boolean {
  if (!hasOrder) return true;
  if (filter.sellerIds && !filter.sellerIds.includes(order.seller_id ?? "")) return false;
  if (filter.unitBusinessIds && !filter.unitBusinessIds.includes(order.unit_business_id ?? "")) return false;
  return true;
}

/** Separa as notas dos movimentos em pedidos que entram (pelo order_id) e contagem de avisos por motivo. */
export function classifyInvoices(
  invoices: CommissionInvoiceRow[],
  withoutMovement: InvoiceWithoutMovementRow[],
  filter: PeopleFilter,
): {
  includedByOrder: Map<string, CommissionInvoiceRow>;
  warnings: SellerCommissionReportWarnings;
} {
  const warnings: SellerCommissionReportWarnings = {
    invoices_without_movement: 0,
    cancelled_invoices_return_without_movement: 0,
    cancelled_invoices_without_return: 0,
    orders_not_in_seller_report: 0,
    orders_missing_cost: 0,
    orders_not_completed: 0,
  };
  const includedByOrder = new Map<string, CommissionInvoiceRow>();

  for (const invoice of invoices) {
    // Cancelada e devolvida: a saída já foi estornada no Kardex, não entra nem vira aviso.
    if (invoice.invoice_cancelled && invoice.has_return) continue;
    if (!matchesPeopleFilter(invoice, filter, !!invoice.order_id)) continue;
    const reason = exclusionReason(invoice);
    if (!reason) {
      includedByOrder.set(invoice.order_id!, invoice);
      continue;
    }
    // Só conta aviso a venda com vendedor (a que deveria entrar); com vendedor o motivo é sempre um dos avisos.
    if (invoice.has_seller) warnings[reason as keyof SellerCommissionReportWarnings] += 1;
  }

  for (const invoice of withoutMovement) {
    if (!invoice.has_seller || !matchesPeopleFilter(invoice, filter, true)) continue;
    warnings.invoices_without_movement += 1;
  }

  return { includedByOrder, warnings };
}

/** Uma linha por item do seller report; nota e data do movimento vêm da nota que trouxe o pedido. */
export function buildReportRows(
  items: SellerCommissionItemRow[],
  includedByOrder: Map<string, CommissionInvoiceRow>,
): SellerCommissionReportRow[] {
  return items.map((item) => {
    const invoice = includedByOrder.get(item.order_id);
    return {
      order_item_id: item.order_item_id,
      order_id: item.order_id,
      store_name: item.store_name,
      order_date: item.order_date,
      order_number: item.order_number,
      invoice_number: invoice?.invoice_number ?? null,
      movement_date: invoice?.movement_date ?? null,
      seller_name: item.seller_name,
      manager_name: item.manager_names,
      customer_name: item.customer_name,
      brand: item.brand,
      product: item.product_name,
      sku: item.sku,
      quantity: toNumber(scaled(item.quantity)),
      total_value: toNumber(scaled(item.net_total)),
      commission_base: toNumber(scaled(item.commission_base)),
      seller_commission_rate: toNumber(scaled(item.commission_rate)),
      seller_commission_value: toNumber(scaled(item.commission_value)),
      manager_commission_rate: toNumber(scaled(item.manager_commission_rate)),
      manager_commission_value: toNumber(scaled(item.manager_commission_value)),
    };
  });
}

/** Resumo somado das linhas (BigInt): totais de comissão de vendedores e de gerentes. */
export function buildSummary(items: SellerCommissionItemRow[]): SellerCommissionReportSummary {
  const sum = (pick: (item: SellerCommissionItemRow) => DecimalValue): number =>
    toNumber(items.reduce((total, item) => total + scaled(pick(item)), 0n));

  return {
    orders_count: new Set(items.map((item) => item.order_id)).size,
    items_quantity: sum((item) => item.quantity),
    total_value: sum((item) => item.net_total),
    commission_base: sum((item) => item.commission_base),
    total_seller_commission: sum((item) => item.commission_value),
    total_manager_commission: sum((item) => item.manager_commission_value),
  };
}
