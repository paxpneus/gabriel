export interface DailySalesStateFactAttributes {
  id: string;
  fact_date: string;
  unit_business_id?: string | null;
  destination_uf: string;
  orders_count?: number;
  items_quantity?: number | string;
  total_value?: number | string;
  total_freight?: number | string;
  average_freight?: number | string;
  average_ticket?: number | string;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailySalesStateFactCreationAttributes = Omit<
  DailySalesStateFactAttributes,
  "id" | "createdAt" | "updatedAt"
>;
