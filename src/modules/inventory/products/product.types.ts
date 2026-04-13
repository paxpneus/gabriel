export interface ProductAttributes {
  id: string;
  name: string;
  sku: string;
  ean: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductCreationAttributes extends Omit<ProductAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
