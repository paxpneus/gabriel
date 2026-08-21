export interface SalesReportFilters {
  dateFrom: string;
  dateTo: string;
  unitBusinessId?: string;
  unitBusinessIds?: string[];
  storeId?: string;
  state?: string;
  productId?: string;
  sku?: string;
  statusId?: string;
  drillDown?: boolean;
  productIds?: string[];
  brandIds?: string[];
  tireMeasure?: string;
  orderIds?: string[];
}

export interface SalesReportJobResult {
  jobName: string;
  startedAt: Date;
  lastProcessedAt: Date;
  ordersProcessed: number;
}

export interface SalesFactKey {
  fact_date: string;
  unit_business_id: string | null;
  integration_id: string | null;
  status_normalized: string | null;
}

export interface SalesStateFactKey extends SalesFactKey {
  destination_uf: string;
}

export interface SalesStoreFactKey extends SalesFactKey {
  store_id: string;
}

export interface SalesProductFactKey extends SalesFactKey {
  sku: string;
}

export interface SalesStatusFactKey extends SalesFactKey {
  status_id: string;
}
