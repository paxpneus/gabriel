export interface StockAttributes {
  id?: string;
  unit_business_id: string;
  product_id: string;
  quantity: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface StockCreationAttributes extends Omit<StockAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
