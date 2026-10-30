import { buildAuditDescription } from "../../../../../global/audit-logs/helpers/description";
import { deliveryNoteGeneratedAudit } from "../audit";

describe("deliveryNoteGeneratedAudit", () => {
  it("changes e descrição com o nome do operador, nunca o id; data em horário de Brasília", () => {
    const generatedAt = new Date("2026-10-30T13:05:00Z");
    const [entry] = deliveryNoteGeneratedAudit({
      userId: "actor-1",
      batchId: "batch-1",
      batchNumber: "42",
      operatorName: "Fulano",
      before: { delivery_note_generated_at: null, operator_id: null },
      after: { delivery_note_generated_at: generatedAt, operator_id: "user-1" },
    });

    expect(entry.changes.before).toEqual({ delivery_note_generated_at: null, operator_name: null });
    expect(entry.changes.after).toEqual({ delivery_note_generated_at: generatedAt, operator_name: "Fulano" });
    expect(buildAuditDescription(entry.entity, entry.action, entry.changes)).toBe(
      'Lote de expedição alterado — Romaneio do lote 42 gerado. Operador: Fulano — Alterações: Romaneio gerado em: — → 30/10/2026, 10:05:00, Operador: — → "Fulano"',
    );
  });

  it("romaneio já gerado → gerado novamente, com o operador mantido e sem alterações", () => {
    const firstAt = new Date("2026-10-29T13:00:00Z");
    const state = { delivery_note_generated_at: firstAt, operator_id: "user-old" };
    const [entry] = deliveryNoteGeneratedAudit({
      userId: "actor-1",
      batchId: "batch-1",
      batchNumber: "42",
      operatorName: "Beltrano",
      before: state,
      after: state,
    });

    expect(buildAuditDescription(entry.entity, entry.action, entry.changes)).toBe(
      "Lote de expedição alterado — Romaneio do lote 42 gerado novamente. Operador: Beltrano",
    );
  });
});
