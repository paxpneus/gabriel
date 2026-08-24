export interface SupplierDiscountUnitBusinessAttributes {
  id: string;
  supplier_discount_rule_id: string;
  unit_business_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SupplierDiscountUnitBusinessCreationAttributes
  extends Omit<
    SupplierDiscountUnitBusinessAttributes,
    "id" | "createdAt" | "updatedAt"
  > {}
