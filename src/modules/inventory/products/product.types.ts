import Stock from "../stock/stock.model";
import Product from "./product.model";

export interface ProductAttributes {
  id: string;
  name: string;
  sku: string;
  ean: string;
   ean_tribut: string;
  id_system: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductCreationAttributes extends Omit<ProductAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export interface ProductWithStock extends Product {
  stocks: Stock[]
}