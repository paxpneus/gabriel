import {
  batchColorForStage,
  cardBatchColor,
  PDV_BATCH_COLORS,
  PDV_CRITICAL_WARNING_COLOR,
} from "../batch-colors";
import { PdvBatchStage } from "../../pdv-sales-request.types";

describe("batch-colors", () => {
  it("uma cor hex distinta por estágio", () => {
    const colors = [
      PDV_CRITICAL_WARNING_COLOR.color,
      ...PDV_BATCH_COLORS.map((entry) => entry.color),
    ];
    expect(new Set(colors).size).toBe(colors.length);
    colors.forEach((color) => expect(color).toMatch(/^#[0-9A-F]{6}$/));
  });

  it("estágio fora da tabela → null", () => {
    expect(batchColorForStage(PdvBatchStage.IN_BATCH)).toBeNull();
    expect(batchColorForStage(null)).toBeNull();
  });

  it("aviso crítico ignora o estágio do lote", () => {
    expect(cardBatchColor(PdvBatchStage.OPEN_BATCH, true)).toBe("#EF4444");
    expect(cardBatchColor(null, true)).toBe("#EF4444");
    expect(cardBatchColor(PdvBatchStage.OPEN_BATCH, false)).toBe("#22C55E");
  });
});
