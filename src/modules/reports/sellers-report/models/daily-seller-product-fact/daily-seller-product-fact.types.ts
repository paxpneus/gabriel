export interface DailySellerProductFactAttributes {
  id: string;
  fact_date: string;
  seller_id: string;
  product_id: string;
  product_name?: string | null;
  product_brand?: string | null;
  product_measure?: string | null;
  quantity_sold?: number | string;
  orders_count?: number;
  total_sold?: number | string;
  total_cost?: number | string;
  total_commission?: number | string;
  total_markup_value?: number | string;
  total_contribution_value?: number | string;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailySellerProductFactCreationAttributes = Omit<
  DailySellerProductFactAttributes,
  "id" | "createdAt" | "updatedAt"
>;