import { customerAttributes } from "../../customers/customers.types";
import { orderItemsAttributes } from "../order_items/order_items.types";
import { SalesOrderSnapshotAttributes } from "../../../reports/daily-sales/sales-order-snapshot/sales-order-snapshot.types";
import { SalesOrderItemSnapshotAttributes } from "../../../reports/daily-sales/sales-order-item-snapshot/sales-order-item-snapshot.types";

export enum OrderInternalStatus {
  CANCELLED = "CANCELLED",
  EMITTED = "EMITTED",
  WAITING_FOR_NFE_EMISSION = "WAITING FOR NFE EMISSION",
  WAITING_CHANNEL_VALIDATION = "WAITING CHANNEL VALIDATION",
  OPEN = "OPEN",
  SENT_TO_TRANSPORTER = "SENT_TO_TRANSPORTER",
  DELIVERED = "DELIVERED",
  UNKNOWN = "UNKNOWN",
}

export enum CompletedOrderInternalStatus {
  EMITTED = "EMITTED",
  SENT_TO_TRANSPORTER = "SENT_TO_TRANSPORTER",
  DELIVERED = "DELIVERED",
}

export const COMPLETED_ORDER_INTERNAL_STATUSES: readonly OrderInternalStatus[] = [
  OrderInternalStatus.EMITTED,
  OrderInternalStatus.SENT_TO_TRANSPORTER,
  OrderInternalStatus.DELIVERED,
];

export interface orderAttributes {
  id: string;
  integrations_id: string;
  customer_id: string;
  seller_id?: string;
  id_order_system?: string;
  number_order_system: string;
  number_order_channel: string;
  actual_step?: string;
  actual_situation?: string;
  collection_date?: Date;
  date?: Date;
  total_price?: number;
  total_cost?: number;
  nfe_emitted?: boolean;
  internal_status?: OrderInternalStatus;
  store_id?: string | null;
  unit_business_id?: string | null;
  invoice_id?: string | null;
  waiting_acceptance?: boolean;
  source_payload?: Record<string, unknown>;
  total_products?: number;
  total_order?: number;
  discount_value?: number;
  discount_type?: string;
  other_expenses?: number;
  freight_charged?: number;
  freight_cost?: number;
  freight_by_account?: number;
  gross_weight?: number;
  tax_commission?: number;
  tax_base_value?: number;
  marketplace_fee?: number;
  payment_fee?: number;

  // Campos fiscais/geográficos vindos do ERP (ex: endereço do contato na Bling)
  destination_uf?: string;
  destination_city?: string;
  icms_value?: number;
  ipi_value?: number;
  pis_value?: number;
  cofins_value?: number;
  difal_value?: number;
  ibs_value?: number;
  cbs_value?: number;
  approx_tax_value?: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export interface FullOrder extends orderAttributes {
  customer: customerAttributes;
  items: orderItemsAttributes[];
}

// Retorno cru do repository: pedido + snapshot congelado (sales_order_snapshots
// / sales_order_item_snapshots) gerado pelo job do relatório de vendas
// (sales-report). Necessário porque orders/order_items podem ter sido
// alterados desde a venda — o snapshot preserva os valores financeiros
// (custo, comissão, ICMS calculado, contribution) do momento em que o
// relatório foi processado.
export interface OrderWithSalesSnapshotRaw extends orderAttributes {
  customer?: customerAttributes | null;
  salesSnapshot?:
    | (SalesOrderSnapshotAttributes & {
        items?: SalesOrderItemSnapshotAttributes[];
      })
    | null;
}

export interface OrderSalesReportDetail {
  order: orderAttributes;
  customer: customerAttributes | null;
  // Preço bruto da venda (total_products do snapshot).
  grossPrice: number;
  // Lucro real da venda (contribution_value do snapshot).
  profit: number;
  // Margem de lucro da venda, em % (contribution_pct do snapshot).
  profitMargin: number;
  markupPct: number;
  discount: number;
  icms: number;
  commission: number;
  totalCost: number;
  totalTaxes: number;
  totalFees: number;
  freightCost: number;
  taxCommission: number;
  marketplaceFee: number;
  paymentFee: number;
  // Snapshot completo (todos os campos gerados pelo relatório de vendas)
  // e seus itens, para não perder nenhum dado já calculado no job.
  snapshot: SalesOrderSnapshotAttributes;
  items: SalesOrderItemSnapshotAttributes[];
}

export type orderCreationAttributes = Omit<
  orderAttributes,
  "id" | "createdAt" | "updatedAt"
>;
