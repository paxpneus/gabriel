import { buildAuditEntries } from "../../../../../../global/audit-logs/helpers/audit-change";
import { AuditAction, AuditEntity, AuditLogEntry, AuditOrigin } from "../../../../../../global/audit-logs/audit-log.types";

type TransferLinkState = { transfer_invoice_id?: string | null; transfer_invoice_reference?: string | null };

// Nota de transferência vinculada, trocada ou removida na nota de venda (PDV, tela da nota ou lote); pelo link do PDV fica marcado.
export const transferInvoiceLinkAudit = (params: {
  userId: string | null;
  origin: AuditOrigin;
  invoiceId: string;
  invoiceNumber: string;
  before: TransferLinkState;
  after: TransferLinkState;
}): AuditLogEntry[] => {
  const { before, after } = params;
  let summary = `Nota de transferência ${after.transfer_invoice_reference ?? ""} vinculada na nota de venda ${params.invoiceNumber}`;
  if (!after.transfer_invoice_id) {
    summary = `Nota de transferência ${before.transfer_invoice_reference ?? ""} removida da nota de venda ${params.invoiceNumber}`;
  } else if (before.transfer_invoice_id || before.transfer_invoice_reference) {
    summary = `Nota de transferência da nota de venda ${params.invoiceNumber} trocada de ${before.transfer_invoice_reference ?? "—"} para ${after.transfer_invoice_reference ?? "—"}`;
  }
  if (params.origin === AuditOrigin.PDV) summary += " (pelo link do PDV, sem usuário logado)";

  return buildAuditEntries({
    userId: params.userId,
    origin: params.origin,
    summary,
    main: {
      entity: AuditEntity.INVOICE,
      action: AuditAction.UPDATE,
      fields: ["transfer_invoice_id", "transfer_invoice_reference"],
      change: { id: params.invoiceId, before, after },
    },
  });
};
