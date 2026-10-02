import {
  paymentMethodMatchesReceipt,
  paymentMethodsMatchReceipts,
  receiptTypeFromPaymentMethod,
  resolvePaymentMethodForReceipt,
} from "../payment-method-match";

describe("paymentMethodMatchesReceipt", () => {
  it("retorna null quando não há forma de pagamento ou tipo de comprovante", () => {
    expect(paymentMethodMatchesReceipt(null, "pix")).toBeNull();
    expect(paymentMethodMatchesReceipt("Pix", null)).toBeNull();
  });

  it("reconhece PIX", () => {
    expect(paymentMethodMatchesReceipt("Pix", "pix")).toBe(true);
    expect(paymentMethodMatchesReceipt("Cartão de Crédito", "pix")).toBe(false);
  });

  it("reconhece crédito e débito mesmo com acento", () => {
    expect(
      paymentMethodMatchesReceipt("Cartão de Crédito Itaú", "cartao_credito"),
    ).toBe(true);
    expect(
      paymentMethodMatchesReceipt("Cartão de Débito", "cartao_debito"),
    ).toBe(true);
    expect(paymentMethodMatchesReceipt("Cartão de Débito", "pix")).toBe(false);
  });

  it("reconhece transferência/depósito", () => {
    expect(
      paymentMethodMatchesReceipt("Transferência Bancária", "transferencia"),
    ).toBe(true);
    expect(paymentMethodMatchesReceipt("Depósito", "transferencia")).toBe(true);
  });

  it("descrição em texto livre sem nenhuma palavra-chave reconhecida: false", () => {
    expect(paymentMethodMatchesReceipt("Mercado Pago", "pix")).toBe(false);
  });
});

const method = (id: string, description: string) => ({ id, description });
const receipt = (
  type: "pix" | "cartao_credito" | "cartao_debito" | "transferencia" | null,
  paymentMethodId: string | null = null,
) => ({ type, paymentMethodId });

describe("receiptTypeFromPaymentMethod", () => {
  it("deriva o tipo por palavra-chave", () => {
    expect(receiptTypeFromPaymentMethod("Pix")).toBe("pix");
    expect(receiptTypeFromPaymentMethod("Cartão de Crédito Itaú")).toBe(
      "cartao_credito",
    );
    expect(receiptTypeFromPaymentMethod("Cartão de Débito")).toBe(
      "cartao_debito",
    );
    expect(receiptTypeFromPaymentMethod("Depósito")).toBe("transferencia");
  });

  it("retorna null quando ambíguo ou sem palavra-chave", () => {
    expect(receiptTypeFromPaymentMethod("Cartão")).toBeNull();
    expect(receiptTypeFromPaymentMethod("Mercado Pago")).toBeNull();
    expect(receiptTypeFromPaymentMethod(null)).toBeNull();
  });
});

describe("resolvePaymentMethodForReceipt", () => {
  const pix = method("1", "Pix");
  const credit = method("2", "Cartão de Crédito");
  const creditItau = method("3", "Cartão de Crédito Itaú");

  it("prefere a forma do pedido", () => {
    expect(
      resolvePaymentMethodForReceipt(
        "cartao_credito",
        [creditItau],
        [credit, creditItau],
      ),
    ).toEqual(creditItau);
  });

  it("cai pro catálogo quando o pedido não tem candidata", () => {
    expect(
      resolvePaymentMethodForReceipt("pix", [credit], [pix, credit]),
    ).toEqual(pix);
  });

  it("retorna null quando ambíguo ou sem tipo", () => {
    expect(
      resolvePaymentMethodForReceipt(
        "cartao_credito",
        [],
        [credit, creditItau],
      ),
    ).toBeNull();
    expect(resolvePaymentMethodForReceipt(null, [pix], [pix])).toBeNull();
    expect(
      resolvePaymentMethodForReceipt("transferencia", [], [pix]),
    ).toBeNull();
  });
});

describe("paymentMethodsMatchReceipts", () => {
  const pix = method("1", "Pix");
  const credit = method("2", "Cartão de Crédito");

  it("retorna null sem formas, sem comprovantes ou com comprovante sem tipo nem forma", () => {
    expect(paymentMethodsMatchReceipts([], [receipt("pix")])).toBeNull();
    expect(paymentMethodsMatchReceipts([pix], [])).toBeNull();
    expect(paymentMethodsMatchReceipts([pix], [receipt(null)])).toBeNull();
  });

  it("sem forma no comprovante, compara por palavra-chave do tipo", () => {
    expect(
      paymentMethodsMatchReceipts(
        [credit, pix],
        [receipt("pix"), receipt("cartao_credito")],
      ),
    ).toBe(true);
    expect(paymentMethodsMatchReceipts([credit, pix], [receipt("pix")])).toBe(
      false,
    );
    expect(
      paymentMethodsMatchReceipts(
        [pix],
        [receipt("pix"), receipt("cartao_credito")],
      ),
    ).toBe(false);
  });

  it("parcelas repetidas da mesma forma são cobertas por um comprovante só", () => {
    expect(
      paymentMethodsMatchReceipts(
        [credit, credit],
        [receipt("cartao_credito")],
      ),
    ).toBe(true);
  });

  it("com forma escolhida no comprovante, compara por id", () => {
    expect(
      paymentMethodsMatchReceipts(
        [pix, credit],
        [receipt("pix", "1"), receipt(null, "2")],
      ),
    ).toBe(true);
    // keyword bateria (Pix), mas a forma escolhida é outra
    expect(paymentMethodsMatchReceipts([pix], [receipt("pix", "9")])).toBe(
      false,
    );
  });
});
