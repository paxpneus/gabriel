export interface SupplierDiscountRuleRimAttributes {
  id: string;
  supplier_discount_rule_id: string;
  rim_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SupplierDiscountRuleRimCreationAttributes
  extends Omit<
    SupplierDiscountRuleRimAttributes,
    "id" | "createdAt" | "updatedAt"
  > {}
