import Stock from "../stock/stock.model";
import Product from "./product.model";

export interface ProductAttributes {
  id: string;
  name: string;
  ean?: string;
  ean_tribut?: string;
  id_system?: string;
  type?: string;
  integrations_id?: string;
  supplier_id?: string;
  source_payload?: Record<string, unknown>;
  unit?: string;
  brand?: string;
  line?: string | null;
  measure?: string | null;
  gross_weight?: number;
  net_weight?: number;
  stock_virtual_total?: number;
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