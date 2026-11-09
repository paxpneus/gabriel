

export interface ExpeditionBatchInvoiceAttributes {
  id: string;
  expedition_batch_id: string;
  invoice_id: string;
  // Nota de transbordo na loja do lote (nem emissora nem destinatária).
  is_transshipment?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}



export interface ExpeditionBatchInvoiceCreationAttributes extends Omit<ExpeditionBatchInvoiceAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
