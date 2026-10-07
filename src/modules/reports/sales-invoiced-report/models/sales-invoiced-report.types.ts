export interface SalesInvoicedReportParams {
  startDate: string;
  endDate: string;
}

type DecimalValue = string | number | null;

/** Linha crua do repository (raw + nest): item do snapshot + pedido + includes. */
export interface SalesInvoicedItemRow {
  order_item_id: string;
  sku: string | null;
  description: string | null;
  quantity: DecimalValue;
  kit_multiplier: DecimalValue;
  net_total: DecimalValue;
  net_value: DecimalValue;
  average_cost_snapshot: DecimalValue;
  total_cost_snapshot: DecimalValue;
  contribution_value: DecimalValue;
  orderSnapshot: {
    order_id: string;
    order_number_system: string | null;
    order_date: string;
    total_products: DecimalValue;
    net_value: DecimalValue;
    total_cost: DecimalValue;
    contribution_value: DecimalValue;
    unitBusiness: { name: string | null } | null;
    invoice: {
      id: string | null;
      number_system: string | null;
      total_expected: DecimalValue;
    } | null;
    seller: { name: string | null } | null;
  };
  product: {
    name: string | null;
    brandRegister: { name: string | null } | null;
  } | null;
}

export interface SalesInvoicedTotalsRow {
  orders_count: DecimalValue;
  items_quantity: DecimalValue;
  gross_revenue: DecimalValue;
  total_discount: DecimalValue;
  total_net_value: DecimalValue;
  total_marketplace_fees: DecimalValue;
  total_freight: DecimalValue;
  total_taxes: DecimalValue;
  total_commission: DecimalValue;
  total_cost: DecimalValue;
  total_supplier_discount: DecimalValue;
  contribution_value: DecimalValue;
  contribution_pct: DecimalValue;
  markup_pct: DecimalValue;
  average_ticket: DecimalValue;
}

export interface SalesInvoicedReportRow {
  order_id: string;
  store_name: string | null;
  order_date: string;
  order_number: string | null;
  seller_name: string | null;
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
}

export interface SalesInvoicedReportSummary {
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
}

export interface SalesInvoicedReport {
  filters: {
    start_date: string;
    end_date: string;
    statuses: string[];
  };
  rows: SalesInvoicedReportRow[];
  summary: SalesInvoicedReportSummary;
}
