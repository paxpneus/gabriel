export interface ProductAttributes {
  id: string;
  name: string;
  sku: string;
  ean: string;
  id_system: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductCreationAttributes extends Omit<ProductAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
