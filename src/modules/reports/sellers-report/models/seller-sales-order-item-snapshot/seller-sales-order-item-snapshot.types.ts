export interface SellerSalesOrderItemSnapshotAttributes {
  id: string;
  order_item_id: string;
  order_id: string;
  seller_id?: string | null;
  customer_id?: string | null;
  product_id?: string | null;
  unit_business_id?: string | null;
  order_date: string;
  product_name?: string | null;
  product_brand?: string | null;
  product_measure?: string | null;
  quantity?: number | string;
  unit_price?: number | string;
  net_total?: number | string;
  average_cost?: number | string;
  total_cost?: number | string;
  commission_rate?: number | string;
  commission_value?: number | string;
  commission_base?: number | string;
  manager_commission_rate?: number | string;
  manager_commission_value?: number | string;
  markup_value?: number | string;
  markup_pct?: number | string;
  contribution_value?: number | string;
  contribution_pct?: number | string;
  is_valid_sale: boolean;
  last_updated_at?: Date;
  has_cost_data: boolean;
  icms_value_allocated?: number | string;
  tax_commission_allocated?: number | string;
  freight_cost_allocated?: number | string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SellerSalesOrderItemSnapshotCreationAttributes = Omit<
  SellerSalesOrderItemSnapshotAttributes,
  "id" | "createdAt" | "updatedAt"
>;