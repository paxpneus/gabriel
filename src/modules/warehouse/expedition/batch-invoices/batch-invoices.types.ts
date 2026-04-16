export interface ExpeditionBatchInvoiceAttributes {
  id: string;
  expedition_batch_id: string;
  invoice_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ExpeditionBatchInvoiceCreationAttributes extends Omit<ExpeditionBatchInvoiceAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
