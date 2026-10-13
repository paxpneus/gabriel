import {
  buildExpeditionBatchNumber,
  extractExpeditionBatchSequence,
} from "../expedition-batch-number";

describe("expedition batch number", () => {
  it("extrai a sequência do nome gerado pelo próprio builder", () => {
    const number = buildExpeditionBatchNumber("RODONAVES TRANSPS E ENCOMENDAS LTDA", "21", 842);

    expect(number).toBe("RODONAVES TRANSPS E ENCOMENDAS LTDA_LOJA21_0842");
    expect(extractExpeditionBatchSequence(number)).toBe("0842");
  });

  it("transportadora com _ ou LOJA no nome usa sempre o último segmento", () => {
    expect(extractExpeditionBatchSequence("TRANSP_LOJA_X_LOJA21_0007")).toBe("0007");
  });

  it("sequência acima de 4 dígitos vem inteira", () => {
    expect(extractExpeditionBatchSequence("T_LOJA21_12345")).toBe("12345");
  });

  it("fora do formato ou vazio → null", () => {
    expect(extractExpeditionBatchSequence("LOTE-ANTIGO")).toBeNull();
    expect(extractExpeditionBatchSequence(null)).toBeNull();
    expect(extractExpeditionBatchSequence(undefined)).toBeNull();
  });
});
