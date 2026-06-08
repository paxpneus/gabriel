

export interface ProductConfigAttributes {
  id: string;
  product_id: string;
  unit_business_id: string;

  sku?: string;

  price?: number;
  supplier_cost_price?: number;
  supplier_purchase_price?: number;
  average_cost?: number;
  average_cost_updated_at?: Date;

  ncm?: string;
  cest?: string;
  gtin?: string;
  gtin_package?: string;

  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export type ProductConfigCreationAttributes = Omit<
  ProductConfigAttributes,
  'id' | 'createdAt' | 'updatedAt'
>;
