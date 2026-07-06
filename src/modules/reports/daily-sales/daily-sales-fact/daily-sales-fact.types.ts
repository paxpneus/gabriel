export interface DailySalesFactAttributes {
  id: string;
  fact_date: string;
  unit_business_id?: string | null;
  integration_id?: string | null;

  orders_count?: number;
  items_quantity?: number | string;
  total_value?: number | string;
  total_freight?: number | string;
  average_freight?: number | string;
  average_ticket?: number | string;

  total_cost?: number | string;
  total_taxes?: number | string;
  total_fees?: number | string;
  contribution_value?: number | string;
  contribution_pct?: number | string;
  markup_pct?: number | string;
  total_commission?: number | string;

  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailySalesFactCreationAttributes = Omit<
  DailySalesFactAttributes,
  "id" | "createdAt" | "updatedAt"
>;