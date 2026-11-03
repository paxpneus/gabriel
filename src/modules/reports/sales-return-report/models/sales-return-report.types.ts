export interface SalesReturnReportParams {
  startDate: string;
  endDate: string;
}

type DecimalValue = string | number | null;

/** Linha crua do repository: movimento CUSTOMER_RETURN (valores Bling) + nota/venda/pedido de origem + item vendido já proporcional. */
export interface SalesReturnLineRow {
  movement_id: string;
  return_invoice_id: string | null;
  return_invoice_number: string | null;
  return_date: string | null;
  sku: string | null;
  description: string | null;
  quantity: DecimalValue;
  total_value: DecimalValue;
  has_price: boolean;
  product_name: string | null;
  brand_name: string | null;
  sale_invoice_number: string | null;
  order_id: string | null;
  order_number_system: string | null;
  order_date: string | null;
  store_name: string | null;
  seller_name: string | null;
  customer_name: string | null;
  has_sale_item: boolean;
  net_value: DecimalValue;
  total_cost: DecimalValue;
  contribution_value: DecimalValue;
  discount_value: DecimalValue;
  tax_commission: DecimalValue;
  freight_cost: DecimalValue;
  computed_icms_value: DecimalValue;
  commission_value: DecimalValue;
  supplier_discount_value: DecimalValue;
}

export interface SalesReturnReportRow {
  movement_id: string;
  return_invoice_id: string | null;
  return_invoice_number: string | null;
  return_date: string | null;
  order_id: string | null;
  store_name: string | null;
  order_date: string | null;
  order_number: string | null;
  seller_name: string | null;
  customer_name: string | null;
  invoice_number: string | null;
  brand: string | null;
  product: string | null;
  sku: string | null;
  quantity: number;
  total_value: number;
  net_value: number;
  unit_cost: number;
  item_total_cost: number;
  order_total_value: number;
  order_net_value: number;
  order_total_cost: number;
  profit: number;
  order_profit: number;
  volumes: number;
  has_price: boolean;
  has_sale_item: boolean;
}

export interface SalesReturnReportSummary {
  orders_count: number;
  items_quantity: number;
  total_volumes: number;
  gross_revenue: number;
  total_discount: number;
  total_net_value: number;
  total_marketplace_fees: number;
  total_freight: number;
  total_taxes: number;
  total_commission: number;
  total_cost: number;
  total_supplier_discount: number;
  contribution_value: number;
  contribution_pct: number;
  markup_pct: number;
  average_ticket: number;
  lines_without_sale_item: number;
  lines_without_price: number;
}

export interface SalesReturnReport {
  filters: {
    start_date: string;
    end_date: string;
    unit_business_id: string;
  };
  rows: SalesReturnReportRow[];
  summary: SalesReturnReportSummary;
}
