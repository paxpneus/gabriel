export interface SupplierMappingAttributes {
  id: string;
  product_id: string;
  supplier_cnpj: string;
  supplier_product_code: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SupplierMappingCreationAttributes extends Omit<SupplierMappingAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
