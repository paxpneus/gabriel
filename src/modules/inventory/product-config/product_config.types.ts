

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
  // Só leitura: EAN que o ERP manda, nunca usado em resolução/busca/filtro.
  gtin_erp?: string | null;
  // Só leitura: SKU que o ERP manda, nunca usado em resolução/busca/filtro.
  sku_erp?: string | null;

  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export type ProductConfigCreationAttributes = Omit<
  ProductConfigAttributes,
  'id' | 'createdAt' | 'updatedAt'
>;
