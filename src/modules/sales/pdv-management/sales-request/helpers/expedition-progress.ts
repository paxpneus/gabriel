export enum PdvExpeditionProgress {
  NOT_IN_BATCH = "NOT_IN_BATCH",
  IN_BATCH = "IN_BATCH",
  BATCH_FINISHED = "BATCH_FINISHED",
  DELIVERY_NOTE_GENERATED = "DELIVERY_NOTE_GENERATED",
}

export interface PdvExpeditionBatchStatus {
  in_batch: boolean;
  batch_finished: boolean;
  delivery_note_generated: boolean;
}

export interface PdvExpeditionProgressResult extends PdvExpeditionBatchStatus {
  progress: PdvExpeditionProgress;
  progress_message: string;
}

const PROGRESS_MESSAGE: Record<PdvExpeditionProgress, string> = {
  [PdvExpeditionProgress.NOT_IN_BATCH]: "Lote ainda não gerado!",
  [PdvExpeditionProgress.IN_BATCH]: "Lote gerado, conferência de produtos em andamento",
  [PdvExpeditionProgress.BATCH_FINISHED]:
    "Lote finalizado, mas precisa gerar romaneio",
  [PdvExpeditionProgress.DELIVERY_NOTE_GENERATED]:
    "Romaneio gerado mas não atualizado no hub, finalize manualmente!",
};

// Romaneio só conta com lote finalizado — combinação fora da tabela
// (romaneio sem lote finalizado) cai em IN_BATCH.
export function buildExpeditionProgress(
  status: PdvExpeditionBatchStatus,
): PdvExpeditionProgressResult {
  let progress = PdvExpeditionProgress.IN_BATCH;
  if (!status.in_batch) progress = PdvExpeditionProgress.NOT_IN_BATCH;
  else if (status.batch_finished && status.delivery_note_generated)
    progress = PdvExpeditionProgress.DELIVERY_NOTE_GENERATED;
  else if (status.batch_finished)
    progress = PdvExpeditionProgress.BATCH_FINISHED;

  return {
    in_batch: status.in_batch,
    batch_finished: status.batch_finished,
    delivery_note_generated: status.delivery_note_generated,
    progress,
    progress_message: PROGRESS_MESSAGE[progress],
  };
}
