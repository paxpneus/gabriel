export interface UnmappedInvoiceProductAttributes {
  id: string;
  invoice_id: string | null;
  ean: string | null;
  sku: string | null;
  product_name: string | null;
  reason: string;
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
