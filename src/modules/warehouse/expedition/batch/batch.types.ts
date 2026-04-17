import { InvoiceItemsAttributes } from '../../entrance/invoice-items/invoice-items.types';
import { InvoiceAttributes } from '../../entrance/invoice/invoice.types';
import { ExpeditionBatchInvoiceAttributes } from './../batch-invoices/batch-invoices.types';
export interface ExpeditionBatchAttributes {
  id: string;
  number: string;
  status: 'OPEN' | 'PENDING' | 'FINISHED';
  integrations_id?: string;
  id_system?: string;
  unit_business_id: string;
  total_volumes: number;
  createdAt?: Date;
  updatedAt?: Date;
  batchInvoices?: any;

}

export interface InvoiceFull extends InvoiceAttributes {
  items: InvoiceItemsAttributes[]
}

export interface ExpeditionBatchInvoiceFull extends ExpeditionBatchInvoiceAttributes {
  invoice: InvoiceFull
}

export interface ExpeditionBatchFull {
  id: string;
  number: string;
  status: 'OPEN' | 'PENDING' | 'FINISHED';
  integrations_id?: string;
  id_system?: string;
  unit_business_id: string;
  total_volumes: number;
  createdAt?: Date;
  updatedAt?: Date;
  batchInvoices?: ExpeditionBatchInvoiceFull[];

}



export interface ExpeditionBatchCreationAttributes extends Omit<ExpeditionBatchAttributes, 'id' | 'createdAt' | 'updatedAt'> {}
