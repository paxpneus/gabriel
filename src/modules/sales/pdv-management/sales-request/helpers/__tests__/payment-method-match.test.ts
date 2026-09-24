import { paymentMethodMatchesReceipt } from "../payment-method-match";

describe("paymentMethodMatchesReceipt", () => {
  it("retorna null quando não há forma de pagamento ou tipo de comprovante", () => {
    expect(paymentMethodMatchesReceipt(null, "pix")).toBeNull();
    expect(paymentMethodMatchesReceipt("Pix", null)).toBeNull();
  });

  it("reconhece PIX", () => {
    expect(paymentMethodMatchesReceipt("Pix", "pix")).toBe(true);
    expect(paymentMethodMatchesReceipt("Cartão de Crédito", "pix")).toBe(
      false,
    );
  });

  it("reconhece crédito e débito mesmo com acento", () => {
    expect(
      paymentMethodMatchesReceipt("Cartão de Crédito Itaú", "cartao_credito"),
    ).toBe(true);
    expect(
      paymentMethodMatchesReceipt("Cartão de Débito", "cartao_debito"),
    ).toBe(true);
    expect(paymentMethodMatchesReceipt("Cartão de Débito", "pix")).toBe(
      false,
    );
  });

  it("reconhece transferência/depósito", () => {
    expect(
      paymentMethodMatchesReceipt("Transferência Bancária", "transferencia"),
    ).toBe(true);
    expect(paymentMethodMatchesReceipt("Depósito", "transferencia")).toBe(
      true,
    );
  });

  it("descrição em texto livre sem nenhuma palavra-chave reconhecida: false", () => {
    expect(paymentMethodMatchesReceipt("Mercado Pago", "pix")).toBe(false);
  });
});
