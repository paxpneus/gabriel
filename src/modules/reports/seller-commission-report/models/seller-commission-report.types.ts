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
  // Loja do pedido (orders.unit_business_id); com gerente junto, fica a interseção.
  unitBusinessIds?: string[];
  // Loja de origem da nota de venda (invoices.origin_unit_business_id).
  originUnitBusinessIds?: string[];
}

type DecimalValue = string | number | null;

/** Linha crua do repository: item do seller report (seller_sales_order_item_snapshots) + nomes. */
export interface SellerCommissionItemRow {
  order_item_id: string;
  order_id: string;
  order_date: string;
  order_number: string | null;
  invoice_number: string | null;
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

/** Pedidos do seller report no período que ficaram fora da comissão, por motivo. */
export interface SellerCommissionReportWarnings {
  // Pedido Em aberto no Bling: conta como venda no seller report, mas sem comissão.
  orders_open: number;
  // Pedido Atendido/Enviado/Entregue no Bling ainda sem nota de venda vinculada.
  orders_final_without_invoice: number;
  // Pedido com item sem custo médio: o seller report não conta como venda válida.
  orders_missing_cost: number;
}

export interface SellerCommissionReport {
  filters: {
    start_date: string;
    end_date: string;
    brand: string[] | null;
    product_id: string[] | null;
    seller_id: string[] | null;
    manager_id: string[] | null;
    unit_business_id: string[] | null;
    origin_unit_business_id: string[] | null;
  };
  rows: SellerCommissionReportRow[];
  summary: SellerCommissionReportSummary;
  warnings: SellerCommissionReportWarnings;
}
