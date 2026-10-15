import { PdvBatchColor, PdvBatchStage } from "../pdv-sales-request.types";

// Fonte única da cor do card (toBoardCard) e da legenda (GET /legend/batch-colors).
export const PDV_BATCH_COLORS: readonly {
  stage: PdvBatchStage;
  label: string;
  color: PdvBatchColor;
}[] = [
  { stage: PdvBatchStage.WITHOUT_BATCH, label: "Sem lote", color: "#FACC15" },
  { stage: PdvBatchStage.OPEN_BATCH, label: "Lote em aberto", color: "#22C55E" },
  {
    stage: PdvBatchStage.FINISHED_WITHOUT_DELIVERY_NOTE,
    label: "Lote finalizado sem romaneio",
    color: "#3B82F6",
  },
];

// Aviso crítico (mesmo critério de critical_warnings) vence qualquer estágio de lote.
export const PDV_CRITICAL_WARNING_COLOR: { label: string; color: PdvBatchColor } = {
  label: "Aviso crítico",
  color: "#EF4444",
};

export function batchColorForStage(
  stage: PdvBatchStage | null | undefined,
): PdvBatchColor | null {
  return PDV_BATCH_COLORS.find((entry) => entry.stage === stage)?.color ?? null;
}

export function cardBatchColor(
  stage: PdvBatchStage | null | undefined,
  hasCriticalWarning: boolean,
): PdvBatchColor | null {
  return hasCriticalWarning
    ? PDV_CRITICAL_WARNING_COLOR.color
    : batchColorForStage(stage);
}
