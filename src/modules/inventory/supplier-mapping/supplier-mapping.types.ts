import Product from "../products/product.model";
import type SupplierMapping from "./supplier-mapping.model";
import type ProductConfig from "../product-config/product_config.model";
import { ProductAttributes } from "../products/product.types";
import type { ProductIntegrationMappingSummary } from "../../integrations/integration-mapping/integration-mapping.types";

// Marca do DE x PARA criado pelo sync de fornecedor da Bling (`PENDING-<id do fornecedor>`): não é CNPJ, não é limpa.
export const SYNC_SUPPLIER_CNPJ_PREFIX = "PENDING-";

export interface SupplierMappingAttributes {
  id: string;
  product_id: string;
  supplier_cnpj?: string;
  supplier_product_code: string;
  integrations_id?: string;
  is_physical_override?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FullSupplierMapping extends SupplierMappingAttributes {
  product: Product
}

export interface SupplierMappingCreationAttributes extends Omit<SupplierMappingAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

// Campos aceitos do body no CRUD por produto; product_id/integrations_id vêm da rota e do usuário logado.
// is_physical_override só é aceito como false no update (desativar EAN físico confirmado).
export type ProductSupplierMappingInput = Pick<
  SupplierMappingAttributes,
  "supplier_product_code" | "supplier_cnpj" | "is_physical_override"
>;

// Donos (outros produtos) de um EAN na integração — retorno de supplierMappingService.findEanOwners;
// linhas vêm com `product` (id, name) incluído e, no ProductConfig, `unitBusiness` (id, name, number).
export interface EanOwners {
  supplierMappings: SupplierMapping[];
  productConfigs: ProductConfig[];
}

// Códigos que o front usa pra decidir a próxima tela (modal de foto ou "Confirmar EAN físico").
export enum SupplierMappingErrorCode {
  PRODUCT_NOT_MAPPED_IN_INTEGRATION = "PRODUCT_NOT_MAPPED_IN_INTEGRATION",
  EAN_HAS_PHYSICAL_OVERRIDE = "EAN_HAS_PHYSICAL_OVERRIDE",
  EAN_OWNED_BY_ANOTHER_PRODUCT = "EAN_OWNED_BY_ANOTHER_PRODUCT",
}

// Produto que já usa o EAN — devolvido no erro EAN_OWNED_BY_ANOTHER_PRODUCT e no retorno do "Confirmar EAN físico".
export interface EanOwnerSummary {
  product_id: string;
  product_name: string | null;
  source: "SUPPLIER_MAPPING" | "PRODUCT_CONFIG";
  code: string;
}

// Resposta 201 do POST /from-unmapped: o que foi criado (null = não criou) e todos os mappings do produto na integração.
export interface CreateFromUnmappedResult {
  supplierMapping: SupplierMapping | null;
  integrationMapping: { id: string; external_id: string; is_primary: boolean } | null;
  integration: { id: string; name: string };
  integrationMappings: ProductIntegrationMappingSummary[];
}

// Impressão de etiqueta (EAN físico em massa): máximo de itens por chamada e quantos rodam em paralelo (cada um ocupa
// uma conexão do pool, que é de 10 e compartilhado pelo app todo).
export const LABEL_PRINT_MAX_ITEMS = 50;
export const LABEL_PRINT_CONCURRENCY = 3;

// Resultado da impressão de etiqueta: sucesso parcial, cada item com o EAN já normalizado.
export interface LabelPrintPhysicalOwnerResult {
  succeeded: {
    product_id: string;
    supplier_product_code: string;
    supplierMapping: SupplierMapping;
    cleared: EanOwnerSummary[];
  }[];
  failed: { product_id: string; supplier_product_code: string; error: Error }[];
}

// Override físico já existente pra outro produto — devolvido no erro EAN_HAS_PHYSICAL_OVERRIDE.
export interface PhysicalOverrideSummary {
  supplier_mapping_id: string;
  product_id: string;
  product_name: string | null;
  code: string;
  user_id: string | null;
  user_name: string | null;
  at: Date | null;
}

// Erro de regra do mapeamento com `code` pro front; controller responde 400 com { error, code, owners?, override? }.
export class SupplierMappingError extends Error {
  constructor(
    public code: SupplierMappingErrorCode,
    message: string,
    public owners?: EanOwnerSummary[],
    public override?: PhysicalOverrideSummary,
  ) {
    super(message);
    this.name = "SupplierMappingError";
  }
}

// Seção do relatório de pendências de integração: EAN físico confirmado que o ERP ainda manda pra outros,
// produto com 2+ códigos no ERP, EAN duplicado no ERP, SKU duplicado no ERP, produto sem EAN no ERP, produto não mapeado.
export const INTEGRATION_PENDING_SECTIONS = [
  "overrides",
  "erp_duplicates",
  "erp_ean_duplicates",
  "erp_sku_duplicates",
  "missing_ean",
  "unmapped",
] as const;
export type IntegrationPendingSection = (typeof INTEGRATION_PENDING_SECTIONS)[number];

// Uma linha do que o ERP manda (erp_data de um mapping): EAN ou SKU de um produto, pelo código principal ou não principal.
export interface ErpEanClaim {
  product_id: string;
  product_name: string | null;
  code: string | null;
  external_id: string;
  source: "ERP_PRIMARY" | "ERP_NON_PRIMARY";
}

// Integração do relatório — o EAN do ERP é do cadastro da integração, igual em todas as lojas dela (não lista loja).
export interface IntegrationPendingIntegration {
  id: string;
  name: string;
}

// Produto que o ERP diz ter o EAN/SKU, com os códigos no ERP (external_id) que mandam — pra corrigir no ERP.
export interface ErpEanClaimProduct {
  product_id: string;
  product_name: string | null;
  eans: string[];
  external_ids: string[];
  sources: Array<"ERP_PRIMARY" | "ERP_NON_PRIMARY">;
  integration: IntegrationPendingIntegration;
}

// Quem prevalece hoje no sistema pro EAN duplicado no ERP, em ordem: override físico, EAN local, DE x PARA, ninguém.
export interface ErpEanPrevailing {
  rule: "PHYSICAL_OVERRIDE" | "LOCAL_GTIN" | "SUPPLIER_MAPPING" | "NONE";
  products: Array<{ product_id: string; product_name: string | null }>;
}
