import { ExpeditionBatchItemsAttributes } from "../batch-items/batch-items.types";

export type BatchInvoiceItemsStatus = 'PENDING' | 'FINISHED';

export interface BatchInvoiceItemsAttributes {
  id: string;
  expedition_batch_item_id: string;
  expedition_batch_invoice_id: string;
  quantity_expected: number;
  quantity_read?: number;
  status: BatchInvoiceItemsStatus;
  createdAt?: Date;
  updatedAt?: Date;

  batchItem?: ExpeditionBatchItemsAttributes
}

export interface BatchInvoiceItemsCreationAttributes
  extends Omit<BatchInvoiceItemsAttributes, 'id' | 'createdAt' | 'updatedAt'> {}