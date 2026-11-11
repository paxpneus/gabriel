import Integration from "../../../integrations/integrations/integrations.model";
import { InvoiceItemsAttributes } from "../../fiscal/invoices/invoice-items/invoice-items.types";
import { InvoiceAttributes } from "../../fiscal/invoices/invoice/invoice.types";
import { BatchInvoiceItemsAttributes } from "../batch-invoice-items/batch-invoice-items.types";
import { ExpeditionBatchInvoiceAttributes } from "./../batch-invoices/batch-invoices.types";
// Lote fechado: não aceita mais remover nota (removeBatchInvoice).
export const CLOSED_EXPEDITION_BATCH_STATUSES: readonly string[] = [
  "FINISHED",
  "CANCELLED",
];

// Justificativas prontas da carta de correção no romaneio (GET /batch/correction-letter/justifications).
// O front troca "{notas}" pelos números das notas com carta de correção e manda o texto pronto na justificativa.
export const CORRECTION_LETTER_JUSTIFICATIONS = [
  {
    code: "WRONG_CARRIER",
    label: "Transportadora errada",
    template:
      "Nota emitida para a transportadora errada: foi emitida para a transportadora própria, mas era para ter ido por transportadora externa. Carta de correção atrelada à nota {notas}.",
  },
] as const;

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
  correction_letter_justification?: string | null;
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
  correction_letter_justification?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  batchWithTotalVolumes?: EnrichedBatchInvoice[];
  batchInvoices?: ExpeditionBatchInvoiceFull[];
  integration?: Integration;
  // Transportadora do lote (include "transporter" do getFullBatch).
  transporter?: { name: string } | null;
}

export interface ExpeditionBatchCreationAttributes extends Omit<
  ExpeditionBatchAttributes,
  "id" | "createdAt" | "updatedAt"
> {}

// Ações de lote do PDV: coluna (SHIPPING usa cd 12/17, SHIP_TODAY usa transporterId); sem salesRequestIds pega todas da coluna (+ transportadora).
export interface PdvBatchActionParams {
  status: string;
  cd?: string;
  transporterId?: string;
  salesRequestIds?: string[];
}

export enum PdvBatchSkipReason {
  NO_PENDING_BATCH = "NO_PENDING_BATCH",
  NO_TRANSPORTER = "NO_TRANSPORTER",
  FAILED = "FAILED",
}

// Grupo (transportadora) que ficou de fora numa ação com sucesso parcial.
export interface PdvBatchSkipped {
  reason_code: PdvBatchSkipReason;
  reason: string;
  transporter_id: string | null;
  transporter_name: string | null;
  sales_request_ids: string[];
  order_numbers: string[];
}

export interface PdvBatchActionResult<T> {
  batches: T[];
  skipped: PdvBatchSkipped[];
  warnings: string[];
}
