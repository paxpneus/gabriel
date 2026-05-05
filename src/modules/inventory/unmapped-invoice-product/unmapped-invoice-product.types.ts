export interface UnmappedInvoiceProductAttributes {
  id: string;
  invoice_id: string;
  ean: string | null;
  sku: string | null;
  product_name: string | null;
  reason: string;
  createdAt?: Date;
  updatedAt?: Date;
  status: string;
  quantity?: number;
  image_path?: string;
}

export interface UnmappedInvoiceProductCreationAttributes
  extends Omit<UnmappedInvoiceProductAttributes, 'id' | 'createdAt' | 'updatedAt'> {}