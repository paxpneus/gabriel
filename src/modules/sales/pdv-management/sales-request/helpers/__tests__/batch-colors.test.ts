import { batchColorForStage, PDV_BATCH_COLORS } from "../batch-colors";
import { PdvBatchStage } from "../../pdv-sales-request.types";

describe("batch-colors", () => {
  it("uma cor hex distinta por estágio", () => {
    const colors = PDV_BATCH_COLORS.map((entry) => entry.color);
    expect(new Set(colors).size).toBe(colors.length);
    colors.forEach((color) => expect(color).toMatch(/^#[0-9A-F]{6}$/));
  });

  it("estágio fora da tabela → null", () => {
    expect(batchColorForStage(PdvBatchStage.IN_BATCH)).toBeNull();
    expect(batchColorForStage(null)).toBeNull();
  });
});
