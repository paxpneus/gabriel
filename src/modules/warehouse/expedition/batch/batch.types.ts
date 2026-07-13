import Integration from "../../../integrations/integrations/integrations.model";
import { InvoiceItemsAttributes } from "../../invoices/invoice-items/invoice-items.types";
import { InvoiceAttributes } from "../../invoices/invoice/invoice.types";
import { BatchInvoiceItemsAttributes } from "../batch-invoice-items/batch-invoice-items.types";
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
  delivery_note_generated_at?: Date | null;
  finished_at?: Date | null;
  operator_id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EnrichedBatchInvoice extends ExpeditionBatchInvoiceFull {
  invoice: InvoiceAttributes & {
    key: string
    invoiceVolume: number
  }
}

export interface ExpeditionBatchInvoiceFull extends ExpeditionBatchInvoiceAttributes {
  invoice: InvoiceAttributes;
  items?: BatchInvoiceItemsAttributes[]
}

export interface ExpeditionBatchFull {
  id: string;
  number: string;
  status: "OPEN" | "PENDING" | "FINISHED";
  integrations_id?: string;
  id_system?: string;
  unit_business_id: string;
  total_volumes: number;
  transporters_id?: string | null;
  delivery_note_generated_at?: Date | null;
  type?: string;
  mode?: string;
  operator_id?: string;
  createdAt?: Date;
  updatedAt?: Date;
  batchWithTotalVolumes?: EnrichedBatchInvoice[];
  batchInvoices?: ExpeditionBatchInvoiceFull[];
  integration?: Integration;
}

export interface ExpeditionBatchCreationAttributes extends Omit<
  ExpeditionBatchAttributes,
  "id" | "createdAt" | "updatedAt"
> {}
