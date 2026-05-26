import Stock from "../stock/stock.model";
import Product from "./product.model";

export interface ProductAttributes {
  id: string;
  name: string;
  sku?: string;
  ean?: string;
  ean_tribut?: string;
  id_system?: string;
  price?: number;
  type?: string;
  integrations_id?: string;
  supplier_id?: string;
  supplier_cost_price?: number;
  supplier_purchase_price?: number;
  source_payload?: Record<string, unknown>;
  unit?: string;
  brand?: string;
  line?: string | null;
  measure?: string | null;
  gross_weight?: number;
  net_weight?: number;
  gtin?: string;
  gtin_package?: string;
  ncm?: string;
  cest?: string;
  stock_virtual_total?: number;
  average_cost?: number | null;
  average_cost_updated_at?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductCreationAttributes extends Omit<
  ProductAttributes,
  "id" | "createdAt" | "updatedAt"
> {}

export interface ProductWithStock extends Product {
  stocks: Stock[];
}
