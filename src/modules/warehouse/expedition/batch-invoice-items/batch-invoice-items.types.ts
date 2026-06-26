export interface BatchInvoiceItemsAttributes {
  id: string;
  expedition_batch_item_id: string;
  expedition_batch_invoice_id: string;
  quantity_expected: number;
  quantity_read?: number;
  status: 'PENDING' | 'FINISHED';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BatchInvoiceItemsCreationAttributes
  extends Omit<BatchInvoiceItemsAttributes, 'id' | 'createdAt' | 'updatedAt'> {}