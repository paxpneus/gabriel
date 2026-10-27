import Product from "../products/product.model";
import type SupplierMapping from "./supplier-mapping.model";
import type ProductConfig from "../product-config/product_config.model";
import { ProductAttributes } from "../products/product.types";

export interface SupplierMappingAttributes {
  id: string;
  product_id: string;
  supplier_cnpj?: string;
  supplier_product_code: string;
  integrations_id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FullSupplierMapping extends SupplierMappingAttributes {
  product: Product
}

export interface SupplierMappingCreationAttributes extends Omit<SupplierMappingAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

// Campos aceitos do body no CRUD por produto; product_id/integrations_id vêm da rota e do usuário logado.
export type ProductSupplierMappingInput = Pick<
  SupplierMappingAttributes,
  "supplier_product_code" | "supplier_cnpj"
>;

// Donos (outros produtos) de um EAN na integração — retorno de supplierMappingService.findEanOwners;
// linhas vêm com `product` (id, name) incluído e, no ProductConfig, `unitBusiness` (id, name, number).
export interface EanOwners {
  supplierMappings: SupplierMapping[];
  productConfigs: ProductConfig[];
}
