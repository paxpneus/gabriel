// unit-business-tax-config.types.ts

export interface UnitBusinessTaxConfigAttributes {
  id: string;
  unit_business_id: string;
  approx_tax_rate: number;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UnitBusinessTaxConfigCreationAttributes
  extends Omit<UnitBusinessTaxConfigAttributes, 'id' | 'createdAt' | 'updatedAt'> {}