import invoiceService from "../../../fiscal/invoices/invoice/invoice.service";
import {
  ADT_TRANSPORTER_CDS,
  extractTransporterCd,
} from "../../../../sales/pdv-management/sales-request/helpers/transporter-cd";
import { ExpeditionBatchFull } from "../batch.types";

// Lote da logística própria (CD 12/17 pelo nome, como no PDV; do lote ou de qualquer nota, como findPendingOutgoingByTransporter):
// toda nota precisa ter transferência existente. "Já vinculada a outra" não é checado aqui: as escritas da referência já barram.
export async function assertAdtBatchTransferReferences(batch: ExpeditionBatchFull): Promise<void> {
  const batchInvoices = batch.batchInvoices ?? [];
  const isAdtBatch = [batch.transporter?.name, ...batchInvoices.map((bi) => bi.invoice.transporter_name)]
    .map(extractTransporterCd)
    .some((cd) => !!cd && ADT_TRANSPORTER_CDS.includes(cd));
  if (!isAdtBatch) return;

  await invoiceService.assertTransferReferences(
    batchInvoices.map((bi) => ({
      invoiceId: bi.invoice_id,
      invoiceNumber: bi.invoice.number_system,
      reference: bi.invoice.transfer_invoice_reference,
    })),
    "Vincule a nota de transferência antes de gerar o romaneio.",
    { checkAlreadyUsed: false },
  );
}
