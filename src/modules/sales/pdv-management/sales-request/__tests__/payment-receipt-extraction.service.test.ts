jest.mock("../helpers/receipt-text-extraction", () => ({
  __esModule: true,
  extractReceiptText: jest.fn(),
}));

jest.mock("../helpers/payment-receipt-text-parser", () => ({
  __esModule: true,
  parsePaymentReceiptText: jest.fn(),
}));

import { extractReceiptText } from "../helpers/receipt-text-extraction";
import { parsePaymentReceiptText } from "../helpers/payment-receipt-text-parser";
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
    (extractReceiptText as jest.Mock).mockResolvedValue("texto qualquer");
    service = new PaymentReceiptExtractionService();
  });

  it("valida a extração com Zod e calcula validated/fingerprint", async () => {
    (parsePaymentReceiptText as jest.Mock).mockReturnValue(baseExtraction);

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

  it("validated = false quando parcelas x valor não bate com o total", async () => {
    (parsePaymentReceiptText as jest.Mock).mockReturnValue({
      ...baseExtraction,
      valor_total: 999,
    });

    const result = await service.analyze(Buffer.from(""), "image/png");
    expect(result.validated).toBe(false);
  });

  it("validated = null quando não é cartão de crédito (ex.: PIX)", async () => {
    (parsePaymentReceiptText as jest.Mock).mockReturnValue({
      ...baseExtraction,
      tipo_comprovante: "pix",
      qtd_parcelas: null,
      valor_parcela: null,
    });

    const result = await service.analyze(Buffer.from(""), "image/png");
    expect(result.validated).toBeNull();
  });

  it("fingerprint = null quando falta algum campo-chave (ex.: sem cnpj)", async () => {
    (parsePaymentReceiptText as jest.Mock).mockReturnValue({
      ...baseExtraction,
      estabelecimento_cnpj: null,
    });

    const result = await service.analyze(Buffer.from(""), "image/png");
    expect(result.fingerprint).toBeNull();
  });

  it("rejeita extração com campo fora do schema (Zod)", async () => {
    (parsePaymentReceiptText as jest.Mock).mockReturnValue({
      ...baseExtraction,
      tipo_comprovante: "boleto",
    });

    await expect(
      service.analyze(Buffer.from(""), "image/png"),
    ).rejects.toThrow();
  });
});
