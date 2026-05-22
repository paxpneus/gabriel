import Stock from "../stock/stock.model";
import Product from "./product.model";

export interface ProductAttributes {
  id: string;
  name: string;
  sku?: string;
  ean: string;
   ean_tribut: string;
  id_system?: string;
  price?: number;
  type?: string
  source_system?: string;
  integrations_id?: string;
  external_id?: string;
  source_payload?: Record<string, unknown>;
  unit?: string;
  brand?: string;
  gross_weight?: number;
  net_weight?: number;
  gtin?: string;
  gtin_package?: string;
  ncm?: string;
  cest?: string;
  supplier_external_id?: string;
  supplier_contact_id?: string;
  supplier_name?: string;
  supplier_product_code?: string;
  supplier_cost_price?: number;
  supplier_purchase_price?: number;
  stock_virtual_total?: number;
  average_cost?: number;
  average_cost_updated_at?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductCreationAttributes extends Omit<ProductAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export interface ProductWithStock extends Product {
  stocks: Stock[]
}
