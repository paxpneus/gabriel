export interface UnitBusinessConfigAttributes {
  id: string;
  unit_business_id: string;
  label_stock_id?: string | null;
  label_shipping_id?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UnitBusinessConfigCreationAttributes
  extends Omit<UnitBusinessConfigAttributes, "id" | "createdAt" | "updatedAt"> {}