// PAYMENT_METHOD: forma de pagamento da integração (Bling formaPagamento.id) → payment_methods.
export const ENTITY_TYPES = ["PRODUCT", "INVOICE", "CONTACT", "PAYMENT_METHOD"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface IntegrationMappingAttributes {
  id: string;
  entity_type: EntityType;
  internal_id: string;
  integrations_id: string;
  external_id: string;
  // Principal da entidade nessa integração: só ele grava dados no sync; o não principal só resolve a entidade.
  is_primary?: boolean;
  // Snapshot só-leitura do que o ERP mandou pra esse external_id (helper por integração) — nunca usado em resolução.
  erp_data?: ProductErpData | PaymentMethodErpData | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IntegrationMappingCreationAttributes extends Omit<IntegrationMappingAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export interface GroupedIntegrationMapping {
  integration_name: string;
  integration_id: string;
}

// erp_data de PRODUCT — campos comuns; cada integração preenche o que tem (Bling: ean_package/stock; Tecinco: stocks por filial).
export interface ProductErpData {
  name: string | null;
  ean: string | null;
  sku: string | null;
  ean_package?: string | null;
  stock?: number | null;
  stocks?: Array<{ branch_id: number; unit_business_id: string | null; unit_business_name?: string | null; quantity: number }>;
  updated_at: string;
}

// Snapshot da forma de pagamento na integração (Bling /formas-pagamentos). installments/card_brand só vêm do
// detalhe da forma (importação de pedido); o populate lista sem eles e mantém o que já estava.
// *_name: nome pra exibir já resolvido no back (front não mapeia código).
export interface PaymentMethodErpData {
  name: string | null;
  type?: number | null;
  type_name?: string | null;
  installments?: number | null;
  card_brand?: number | null;
  card_brand_name?: string | null;
  updated_at: string;
}

// Produto com 2+ códigos (mappings) na integração, cada um com o snapshot do ERP — relatório "Duplicados no ERP".
export interface ProductWithMultipleCodes {
  product_id: string;
  product_name: string | null;
  codes: Array<{
    external_id: string;
    is_primary: boolean;
    // null = código ainda não sincronizado.
    erp_data: { name: string | null; ean: string | null; sku: string | null } | null;
  }>;
}

// Código (EAN ou SKU) que um mapping PRODUCT diz no erp_data, com o produto — relatório de pendências de integração.
export interface ErpCodeRow {
  product_id: string;
  product_name: string | null;
  external_id: string;
  is_primary: boolean;
  // null quando buscado com `missing` (código sincronizado sem o campo).
  code: string | null;
}

// Mapping do produto numa integração com nome/EAN do snapshot do ERP — aviso de vários códigos no vincular não mapeado.
export interface ProductIntegrationMappingSummary {
  id: string;
  external_id: string;
  is_primary: boolean;
  erp_data: { name: string | null; ean: string | null } | null;
}

// Campos aceitos do body no CRUD por produto; entity_type/internal_id vêm da rota (PRODUCT + productId).
export type ProductIntegrationMappingInput = Pick<
  IntegrationMappingAttributes,
  "integrations_id" | "external_id" | "is_primary"
>;
