import { InvoiceStatus } from "../../invoice.types";

// Nota alvo de cancelamento direto (cancelInvoice/bondReturnInvoice): status por unit business + vínculos em lote aberto.
export interface InvoiceCancellationTarget {
  id: string;
  number_system: string;
  return_invoice_reference: string | null;
  statuses: InvoiceStatus[];
  openBatchInvoiceIds: string[];
}
