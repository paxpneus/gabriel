import { BatchInvoiceItemsStatus } from "../../expedition/batch-invoice-items/batch-invoice-items.types";

export interface InvoiceItemsAttributes {
  id: string;
  product_id: string;
  invoice_id: string;
  quantity_expected: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceItemsWithBatchAttributes extends InvoiceItemsAttributes {
  status: BatchInvoiceItemsStatus;
}

export interface InvoiceItemsCreationAttributes extends Omit<InvoiceItemsAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

