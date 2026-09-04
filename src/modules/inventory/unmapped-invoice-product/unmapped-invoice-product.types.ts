// Categoriza a origem do erro sem repetir o nome da integração (isso já
// está em `integrations_id`):
// - ERROR_CATALOG: sync de catálogo Bling/Tecinco sem mapping — único tipo
//   elegível pra criação automática de Product (ver
//   UnmappedInvoiceProductService.createProduct).
// - ERROR_INTEGRATION: cross-check contra outro sistema que não é o ERP de
//   origem do produto (hoje só Magento) — exige apenas mapeamento.
// - ERROR_INVOICE: item de nota fiscal sem produto correspondente.
// - ERROR_SCAN: leitura manual de EAN por foto sem produto correspondente
//   (createUnmappedFromReadingEan).
export type UnmappedInvoiceProductType =
  | "ERROR_CATALOG"
  | "ERROR_INTEGRATION"
  | "ERROR_INVOICE"
  | "ERROR_SCAN";

export interface UnmappedInvoiceProductAttributes {
  id: string;
  invoice_id: string | null;
  ean: string | null;
  sku: string | null;
  product_name: string | null;
  reason: string;
  type: UnmappedInvoiceProductType;
  createdAt?: Date;
  updatedAt?: Date;
  status: string;
  quantity?: number;
  image_path?: string;
  integrations_id?: string | null;
  external_id?: string | null;
}

export interface UnmappedInvoiceProductCreationAttributes
  extends Omit<UnmappedInvoiceProductAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export interface UnmappedInvoiceProductWithImagePreview extends UnmappedInvoiceProductAttributes {
  imagePreview: string
}
