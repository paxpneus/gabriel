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
// - ERROR_CATALOG_DUPLICATE: produto sem mapping/Product ainda, mas cujo
//   sku/código de fábrica/ean colide com outro produto diferente dentro do
//   próprio catálogo da Tecinco — o item ainda passa por processProduct
//   (migrateProdutos sempre enfileira), mas o fallback por sku/ean é
//   pulado e o unmapped é gravado com esse type em vez de ERROR_CATALOG
//   (ver skuDuplicated/eanDuplicated em TCarUpsertJobPayload). Não é
//   elegível pra criação automática de sku/ean — ver
//   SupplierMappingService.createFromUnmapped (só cria integration_mapping
//   pra esse type) e createProductFromTCarData (cria o produto sem
//   preencher o campo ambíguo).
export type UnmappedInvoiceProductType =
  | "ERROR_CATALOG"
  | "ERROR_INTEGRATION"
  | "ERROR_INVOICE"
  | "ERROR_SCAN"
  | "ERROR_CATALOG_DUPLICATE";

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
