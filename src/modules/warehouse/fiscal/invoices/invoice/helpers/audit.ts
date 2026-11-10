import { buildAuditEntries } from "../../../../../global/audit-logs/helpers/audit-change";
import { AuditAction, AuditEntity, AuditLogEntry } from "../../../../../global/audit-logs/audit-log.types";

type CorrectionLetterState = { correction_letter_attached_at?: Date | null };

// Carta de correção anexada/substituída: registra que ela resolve a falta da nota de transferência (pedido era por transportadora).
export const correctionLetterAttachedAudit = (params: {
  userId: string | null;
  invoiceId: string;
  invoiceNumber: string;
  before: CorrectionLetterState;
  after: CorrectionLetterState;
}): AuditLogEntry[] => {
  const attached = params.before.correction_letter_attached_at ? "substituída" : "anexada";
  return buildAuditEntries({
    userId: params.userId,
    summary:
      `Carta de correção ${attached} na nota ${params.invoiceNumber}, corrigindo a falta da nota de transferência: ` +
      "o pedido devia ter ido por transportadora, então a nota segue no lote e no romaneio sem nota de transferência.",
    main: {
      entity: AuditEntity.INVOICE,
      action: AuditAction.UPDATE,
      fields: ["correction_letter_attached_at"],
      change: { id: params.invoiceId, before: params.before, after: params.after },
    },
  });
};
