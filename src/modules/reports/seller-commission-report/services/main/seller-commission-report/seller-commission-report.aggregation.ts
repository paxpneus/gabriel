import { formatScaled, toScaled } from "../../../../../../shared/utils/normalizers/decimal";
import {
  SellerCommissionItemRow,
  SellerCommissionReportRow,
  SellerCommissionReportSummary,
} from "../../../models/seller-commission-report.types";

type DecimalValue = string | number | null | undefined;

const scaled = (value: DecimalValue): bigint => toScaled(value ?? null) ?? 0n;
const toNumber = (value: bigint): number => Number(formatScaled(value));

/** Uma linha por item do seller report, com a nota de venda do pedido. */
export function buildReportRows(items: SellerCommissionItemRow[]): SellerCommissionReportRow[] {
  return items.map((item) => ({
    order_item_id: item.order_item_id,
    order_id: item.order_id,
    store_name: item.store_name,
    order_date: item.order_date,
    order_number: item.order_number,
    invoice_number: item.invoice_number,
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
    regional_manager_name: item.regional_manager_names,
    regional_manager_commission_rate: toNumber(scaled(item.regional_manager_commission_rate)),
    regional_manager_commission_value: toNumber(scaled(item.regional_manager_commission_value)),
    affiliated_name: item.affiliated_name,
    affiliated_commission_value: toNumber(scaled(item.affiliated_commission_value)),
  }));
}

/** Resumo somado das linhas (BigInt): totais de comissão de vendedores, gerentes de loja, regionais, afiliados e o total deles. */
export function buildSummary(items: SellerCommissionItemRow[]): SellerCommissionReportSummary {
  const sumScaled = (pick: (item: SellerCommissionItemRow) => DecimalValue): bigint =>
    items.reduce((total, item) => total + scaled(pick(item)), 0n);
  const sum = (pick: (item: SellerCommissionItemRow) => DecimalValue): number => toNumber(sumScaled(pick));

  const sellerCommission = sumScaled((item) => item.commission_value);
  const managerCommission = sumScaled((item) => item.manager_commission_value);
  const regionalCommission = sumScaled((item) => item.regional_manager_commission_value);
  const affiliatedCommission = sumScaled((item) => item.affiliated_commission_value);

  return {
    orders_count: new Set(items.map((item) => item.order_id)).size,
    items_quantity: sum((item) => item.quantity),
    total_value: sum((item) => item.net_total),
    commission_base: sum((item) => item.commission_base),
    total_seller_commission: toNumber(sellerCommission),
    total_manager_commission: toNumber(managerCommission),
    total_regional_manager_commission: toNumber(regionalCommission),
    total_affiliated_commission: toNumber(affiliatedCommission),
    // Total pago de comissão: vendedor + gerente da loja + regional + afiliado.
    total_commission: toNumber(sellerCommission + managerCommission + regionalCommission + affiliatedCommission),
  };
}
