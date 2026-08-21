export interface SupplierDiscountRuleMeasureAttributes {
  id: string;
  supplier_discount_rule_id: string;
  measure_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SupplierDiscountRuleMeasureCreationAttributes
  extends Omit<
    SupplierDiscountRuleMeasureAttributes,
    "id" | "createdAt" | "updatedAt"
  > {}
