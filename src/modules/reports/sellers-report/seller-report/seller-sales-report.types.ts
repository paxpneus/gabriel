export interface SellerSalesReportFilters {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  sellerId?: string;
  productId?: string;
  brand?: string;
  tireMeasure?: string; // "Aro do Pneu" -> products.measure
  customerId?: string;
  unitBusinessId?: string;
  /** Quando true, retorna também os order_items detalhados (drill-down). */
  drillDown?: boolean;
}

export interface AffectedSellerProductFactKey {
  fact_date: string;
  seller_id: string;
  product_id: string;
}

export interface AffectedSellerCustomerFactKey {
  fact_date: string;
  seller_id: string;
  customer_id: string;
}

interface OrderIdRow {
  order_id: string;
}

export type { OrderIdRow };