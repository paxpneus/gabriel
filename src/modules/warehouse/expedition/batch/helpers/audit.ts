import { buildAuditEntries } from "../../../../global/audit-logs/helpers/audit-change";
import { AuditAction, AuditEntity, AuditLogEntry } from "../../../../global/audit-logs/audit-log.types";

type DeliveryNoteState = { delivery_note_generated_at?: Date | null; operator_id?: string | null };

// Romaneio gerado (rota normal ou PDV): quem gerou = userId; operador pelo nome (changes nunca leva o id do usuário).
export const deliveryNoteGeneratedAudit = (params: {
  userId: string | null;
  batchId: string;
  batchNumber: string;
  // Operador gravado no lote (o de depois); o de antes é ele mesmo ou vazio (COALESCE).
  operatorName: string | null;
  before: DeliveryNoteState;
  after: DeliveryNoteState;
}): AuditLogEntry[] => {
  const withOperatorName = (row: DeliveryNoteState) => ({
    delivery_note_generated_at: row.delivery_note_generated_at ?? null,
    operator_name: row.operator_id ? params.operatorName : null,
  });
  const before = withOperatorName(params.before);
  const after = withOperatorName(params.after);
  // Romaneio já gerado antes: data e operador continuam os da 1ª vez (COALESCE).
  const generated = before.delivery_note_generated_at ? "gerado novamente" : "gerado";

  return buildAuditEntries({
    userId: params.userId,
    summary: `Romaneio do lote ${params.batchNumber} ${generated}. Operador: ${after.operator_name ?? "não informado"}`,
    main: {
      entity: AuditEntity.EXPEDITION_BATCH,
      action: AuditAction.UPDATE,
      fields: ["delivery_note_generated_at", "operator_name"],
      change: { id: params.batchId, before, after },
    },
  });
};
