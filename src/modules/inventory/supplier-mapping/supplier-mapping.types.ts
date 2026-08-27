import Product from "../products/product.model";
import { ProductAttributes } from "../products/product.types";

export interface SupplierMappingAttributes {
  id: string;
  product_id: string;
  supplier_cnpj?: string;
  supplier_product_code: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FullSupplierMapping extends SupplierMappingAttributes {
  product: Product
}

export interface SupplierMappingCreationAttributes extends Omit<SupplierMappingAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
