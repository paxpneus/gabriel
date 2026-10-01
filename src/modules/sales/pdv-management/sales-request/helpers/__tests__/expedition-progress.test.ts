import {
  buildExpeditionProgress,
  PdvExpeditionProgress,
} from "../expedition-progress";

describe("buildExpeditionProgress", () => {
  it("maps not in batch", () => {
    expect(
      buildExpeditionProgress({
        in_batch: false,
        batch_finished: false,
        delivery_note_generated: false,
      }),
    ).toEqual({
      in_batch: false,
      batch_finished: false,
      delivery_note_generated: false,
      progress: PdvExpeditionProgress.NOT_IN_BATCH,
      progress_message: "Lote ainda não gerado!",
    });
  });

  it("maps in batch, not finished", () => {
    const result = buildExpeditionProgress({
      in_batch: true,
      batch_finished: false,
      delivery_note_generated: false,
    });
    expect(result.progress).toBe(PdvExpeditionProgress.IN_BATCH);
    expect(result.progress_message).toBe("Lote gerado");
  });

  it("maps batch finished without delivery note", () => {
    const result = buildExpeditionProgress({
      in_batch: true,
      batch_finished: true,
      delivery_note_generated: false,
    });
    expect(result.progress).toBe(PdvExpeditionProgress.BATCH_FINISHED);
    expect(result.progress_message).toBe(
      "Lote finalizado, mas precisa gerar romaneio",
    );
  });

  it("maps delivery note generated", () => {
    const result = buildExpeditionProgress({
      in_batch: true,
      batch_finished: true,
      delivery_note_generated: true,
    });
    expect(result.progress).toBe(PdvExpeditionProgress.DELIVERY_NOTE_GENERATED);
    expect(result.progress_message).toBe(
      "Romaneio gerado mas não atualizado no hub, finalize manualmente!",
    );
  });

  it("falls back to IN_BATCH for delivery note without finished batch", () => {
    expect(
      buildExpeditionProgress({
        in_batch: true,
        batch_finished: false,
        delivery_note_generated: true,
      }).progress,
    ).toBe(PdvExpeditionProgress.IN_BATCH);
  });
});
