jest.mock("../../../../../shared/utils/documents/document-extraction", () => ({
  __esModule: true,
  extractStructuredDataFromDocument: jest.fn(),
}));

import { extractStructuredDataFromDocument } from "../../../../../shared/utils/documents/document-extraction";
import { PaymentReceiptExtractionService } from "../payment-receipt-extraction.service";

const baseExtraction = {
  tipo_comprovante: "cartao_credito",
  estabelecimento_nome: "Loja X",
  estabelecimento_cnpj: "12345678000199",
  valor_total: 300,
  qtd_parcelas: 3,
  valor_parcela: 100,
  data_transacao: "2026-01-10",
  hora_transacao: "14:30",
  bandeira_cartao: "Visa",
  instituicao_pagamento: "Itaú",
  titular_cartao: "Fulano",
  cartao_final: "1234",
  codigo_autorizacao: "AUTH1",
  nsu_cv: "NSU1",
};

describe("PaymentReceiptExtractionService", () => {
  let service: PaymentReceiptExtractionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentReceiptExtractionService();
  });

  it("faz parse do JSON, valida com Zod e calcula validated/fingerprint", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      JSON.stringify(baseExtraction),
    );

    const result = await service.analyze(Buffer.from(""), "image/png");

    expect(result.extraction.tipo_comprovante).toBe("cartao_credito");
    expect(result.validated).toBe(true);
    expect(result.fingerprint).toBe(
      require("crypto")
        .createHash("sha256")
        .update("12345678000199|2026-01-10|14:30|300.00|1234")
        .digest("hex"),
    );
  });

  it("remove fence de markdown (```json ... ```) antes de parsear", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      "```json\n" + JSON.stringify(baseExtraction) + "\n```",
    );

    const result = await service.analyze(Buffer.from(""), "image/png");
    expect(result.extraction.estabelecimento_nome).toBe("Loja X");
  });

  it("validated = false quando parcelas x valor não bate com o total", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...baseExtraction, valor_total: 999 }),
    );

    const result = await service.analyze(Buffer.from(""), "image/png");
    expect(result.validated).toBe(false);
  });

  it("validated = null quando não é cartão de crédito (ex.: PIX)", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      JSON.stringify({
        ...baseExtraction,
        tipo_comprovante: "pix",
        qtd_parcelas: null,
        valor_parcela: null,
      }),
    );

    const result = await service.analyze(Buffer.from(""), "image/png");
    expect(result.validated).toBeNull();
  });

  it("fingerprint = null quando falta algum campo-chave (ex.: sem cnpj)", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...baseExtraction, estabelecimento_cnpj: null }),
    );

    const result = await service.analyze(Buffer.from(""), "image/png");
    expect(result.fingerprint).toBeNull();
  });

  it("rejeita resposta que não é JSON válido", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      "não é json",
    );

    await expect(
      service.analyze(Buffer.from(""), "image/png"),
    ).rejects.toThrow(/JSON válido/);
  });

  it("rejeita resposta com campo fora do schema (Zod)", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...baseExtraction, tipo_comprovante: "boleto" }),
    );

    await expect(
      service.analyze(Buffer.from(""), "image/png"),
    ).rejects.toThrow();
  });
});
