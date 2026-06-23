export interface DailySellerCustomerFactAttributes {
  id: string;
  fact_date: string;
  seller_id: string;
  customer_id: string;
  customer_name?: string | null;
  orders_count?: number;
  total_purchased?: number | string;
  total_commission?: number | string;
  last_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailySellerCustomerFactCreationAttributes = Omit<
  DailySellerCustomerFactAttributes,
  "id" | "createdAt" | "updatedAt"
>;