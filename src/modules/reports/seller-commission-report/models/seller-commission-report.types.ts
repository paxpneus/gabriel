export interface SellerCommissionReportParams {
  startDate: string;
  endDate: string;
  // products.brand (texto, mesmo filtro do stock flow); ausente = todas.
  brands?: string[];
  productIds?: string[];
  // contacts.id do vendedor (orders.seller_id).
  sellerIds?: string[];
  // contacts.id do gerente (type SELLER_MANAGER); vira a loja dele (contacts.unit_business_id).
  managerIds?: string[];
}

type DecimalValue = string | number | null;

/** Uma linha por nota dos movimentos de saída (ajuste do CSV = pedido), com pedido e situação no seller report. */
export interface CommissionInvoiceRow {
  invoice_key: string;
  invoice_id: string | null;
  invoice_number: string | null;
  is_order_adjustment: boolean;
  movement_date: string;
  invoice_cancelled: boolean;
  // Cancelada com NF de devolução no sistema (movimentada ou não).
  has_return_invoice: boolean;
  return_invoice_number: string | null;
  // Cancelada com NF de devolução movimentada no Kardex: sai do relatório sem aviso.
  has_return: boolean;
  order_id: string | null;
  order_number: string | null;
  seller_id: string | null;
  unit_business_id: string | null;
  // Vendedor preenchido e não "Vendedor 0" (mesmo corte do seller report; loja 0 com vendedor entra).
  has_seller: boolean;
  snapshot_items: number;
  has_cost_data: boolean | null;
  is_valid_sale: boolean | null;
}

/** Nota de saída do CD21 não cancelada sem movimento, com o pedido (filtro de vendedor/gerente e detalhe do problema). */
export interface InvoiceWithoutMovementRow {
  invoice_number: string | null;
  emitted_date: string | null;
  order_id: string | null;
  order_number: string | null;
  // Mesmo corte de vendedor do CommissionInvoiceRow: só esta conta aviso na comissão.
  has_seller: boolean;
  seller_id: string | null;
  unit_business_id: string | null;
}

/** Linha crua do repository: item do seller report (seller_sales_order_item_snapshots) + nomes. */
export interface SellerCommissionItemRow {
  order_item_id: string;
  order_id: string;
  order_date: string;
  order_number: string | null;
  store_name: string | null;
  seller_name: string | null;
  manager_names: string | null;
  customer_name: string | null;
  brand: string | null;
  product_name: string | null;
  sku: string | null;
  quantity: DecimalValue;
  net_total: DecimalValue;
  commission_base: DecimalValue;
  commission_rate: DecimalValue;
  commission_value: DecimalValue;
  manager_commission_rate: DecimalValue;
  manager_commission_value: DecimalValue;
}

export interface SellerCommissionReportRow {
  order_item_id: string;
  order_id: string;
  store_name: string | null;
  order_date: string;
  order_number: string | null;
  invoice_number: string | null;
  movement_date: string | null;
  seller_name: string | null;
  manager_name: string | null;
  customer_name: string | null;
  brand: string | null;
  product: string | null;
  sku: string | null;
  quantity: number;
  total_value: number;
  commission_base: number;
  seller_commission_rate: number;
  seller_commission_value: number;
  manager_commission_rate: number;
  manager_commission_value: number;
}

export interface SellerCommissionReportSummary {
  orders_count: number;
  items_quantity: number;
  total_value: number;
  commission_base: number;
  total_seller_commission: number;
  total_manager_commission: number;
}

/**
 * Quantas vendas com vendedor (as que deveriam entrar) ficaram fora, por motivo.
 * Marketplace e nota sem pedido não têm vendedor: não contam aqui, só no relatório de problemas de integração.
 */
export interface SellerCommissionReportWarnings {
  // Nota de saída não cancelada emitida no período sem movimento de estoque (cancelada sem movimento é ignorada).
  invoices_without_movement: number;
  // Nota cancelada com NF de devolução no sistema, mas sem movimento de devolução no Kardex (com movimento é ignorada).
  cancelled_invoices_return_without_movement: number;
  // Nota cancelada sem NF de devolução (cancelada direto no Bling) com a saída ainda ativa no Kardex.
  cancelled_invoices_without_return: number;
  // Pedido com vendedor ainda não processado pelo job do seller report.
  orders_not_in_seller_report: number;
  // Pedido com item sem custo médio: o seller report não conta como venda válida.
  orders_missing_cost: number;
  // Pedido com custo completo mas situação não concluída.
  orders_not_completed: number;
}

// Motivos sem vendedor identificável (nota inexistente, sem pedido, marketplace "Vendedor 0"): tiram a nota, mas não contam aviso.
export type SellerCommissionWarningReason =
  | Exclude<keyof SellerCommissionReportWarnings, "invoices_without_movement">
  | "movements_without_invoice"
  | "invoices_without_order"
  | "orders_without_seller";

export interface SellerCommissionReport {
  filters: {
    start_date: string;
    end_date: string;
    unit_business_id: string;
    brand: string[] | null;
    product_id: string[] | null;
    seller_id: string[] | null;
    manager_id: string[] | null;
  };
  rows: SellerCommissionReportRow[];
  summary: SellerCommissionReportSummary;
  warnings: SellerCommissionReportWarnings;
}

/** Notas das saídas do CD21 no período e saídas sem movimento: base do relatório e dos problemas de integração. */
export interface SellerCommissionSaleInvoices {
  unitBusinessId: string;
  invoices: CommissionInvoiceRow[];
  withoutMovement: InvoiceWithoutMovementRow[];
}
