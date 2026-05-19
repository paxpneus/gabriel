import { InvoiceItemsAttributes } from "../../entrance/invoice-items/invoice-items.types";
import { InvoiceAttributes } from "../../entrance/invoice/invoice.types";
import { ExpeditionBatchInvoiceAttributes } from "./../batch-invoices/batch-invoices.types";
export interface ExpeditionBatchAttributes {
  id: string;
  number: string;
  justification?: string;
  status: "OPEN" | "PENDING" | "FINISHED";
  integrations_id?: string;
  id_system?: string;
  unit_business_id: string;
  total_volumes: number;
  type?: string;
  batchInvoices?: any;
  total_volumes_received?: number;
  transporters_id?: string | null;
  description?: string
  mode?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceFull extends InvoiceAttributes {
  items: InvoiceItemsAttributes[];
}

export interface ExpeditionBatchInvoiceFull extends ExpeditionBatchInvoiceAttributes {
  invoice: InvoiceFull;
}

export interface ExpeditionBatchFull {
  id: string;
  number: string;
  status: "OPEN" | "PENDING" | "FINISHED";
  integrations_id?: string;
  id_system?: string;
  unit_business_id: string;
  total_volumes: number;
  mode?: string;
  createdAt?: Date;
  updatedAt?: Date;
  batchInvoices?: ExpeditionBatchInvoiceFull[];
}

export interface ExpeditionBatchCreationAttributes extends Omit<
  ExpeditionBatchAttributes,
  "id" | "createdAt" | "updatedAt"
> {}
