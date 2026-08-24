export interface SupplierDiscountRuleBrandAttributes {
  id: string;
  supplier_discount_rule_id: string;
  brand_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SupplierDiscountRuleBrandCreationAttributes
  extends Omit<
    SupplierDiscountRuleBrandAttributes,
    "id" | "createdAt" | "updatedAt"
  > {}
