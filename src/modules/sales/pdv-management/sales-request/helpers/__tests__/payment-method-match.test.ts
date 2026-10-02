import {
  paymentMethodMatchesReceipt,
  paymentMethodsMatchReceipts,
} from "../payment-method-match";

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

describe("paymentMethodsMatchReceipts", () => {
  it("retorna null sem formas de pagamento ou sem comprovantes", () => {
    expect(paymentMethodsMatchReceipts([], ["pix"])).toBeNull();
    expect(paymentMethodsMatchReceipts(["Pix"], [])).toBeNull();
  });

  it("retorna null se algum comprovante não tem tipo", () => {
    expect(paymentMethodsMatchReceipts(["Pix"], ["pix", null])).toBeNull();
  });

  it("retorna true quando todas as formas e todos os comprovantes se correspondem", () => {
    expect(
      paymentMethodsMatchReceipts(
        ["Cartão de Crédito", "Pix"],
        ["pix", "cartao_credito"],
      ),
    ).toBe(true);
  });

  it("parcelas repetidas da mesma forma são cobertas por um comprovante só", () => {
    expect(
      paymentMethodsMatchReceipts(
        ["Cartão de Crédito", "Cartão de Crédito"],
        ["cartao_credito"],
      ),
    ).toBe(true);
  });

  it("retorna false se uma forma da Bling fica sem comprovante", () => {
    expect(
      paymentMethodsMatchReceipts(["Cartão de Crédito", "Pix"], ["pix"]),
    ).toBe(false);
  });

  it("retorna false se há comprovante sem forma correspondente na Bling", () => {
    expect(
      paymentMethodsMatchReceipts(["Pix"], ["pix", "cartao_credito"]),
    ).toBe(false);
  });
});
