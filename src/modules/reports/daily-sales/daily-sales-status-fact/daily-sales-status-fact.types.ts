export interface DailySalesStatusFactAttributes {
  id: string;
  fact_date: string;
  unit_business_id?: string | null;
  status_id: string;
  status_name: string;
  orders_count?: number;
  total_value?: number | string;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailySalesStatusFactCreationAttributes = Omit<
  DailySalesStatusFactAttributes,
  "id" | "createdAt" | "updatedAt"
>;
