export interface DailySalesStoreFactAttributes {
  id: string;
  fact_date: string;
  unit_business_id?: string | null;
  store_id: string;
  orders_count?: number;
  items_quantity?: number | string;
  total_value?: number | string;
  total_freight?: number | string;
  average_ticket?: number | string;
  total_cost?: number | string;
  piece_average_value?: number | string;
  markup_pct?: number | string;
  total_taxes?: number | string;
  total_fees?: number | string;
  contribution_value?: number | string;
  contribution_pct?: number | string;
  total_commission?: number | string;
  total_supplier_discount?: number | string;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailySalesStoreFactCreationAttributes = Omit<
  DailySalesStoreFactAttributes,
  "id" | "createdAt" | "updatedAt"
>;
