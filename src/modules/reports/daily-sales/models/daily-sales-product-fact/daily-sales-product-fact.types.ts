export interface DailySalesProductFactAttributes {
  id: string;
  fact_date: string;
  unit_business_id?: string | null;
  product_id?: string | null;
  sku: string;
  description?: string | null;
  quantity?: number | string;
  total_cost?: number | string;
  total_value?: number | string;
  markup_pct?: number | string;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailySalesProductFactCreationAttributes = Omit<
  DailySalesProductFactAttributes,
  "id" | "createdAt" | "updatedAt"
>;
