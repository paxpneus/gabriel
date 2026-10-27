export interface SellerSalesReportFilters {
  startDate: string;
  endDate: string;
  userId?: string;
  sellerIds?: string[];
  productIds?: string[];
  brandIds?: string[];       
  tireMeasure?: string;
  customerIds?: string[];
  unitBusinessIds?: string[];
  // Contact ids de afiliados (seller_sales_order_item_snapshots.affiliated_id).
  affiliatedIds?: string[];
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