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

  it("crédito nunca casa com forma de débito e vice-versa, mesmo com 'Cartão' na descrição", () => {
    expect(
      paymentMethodMatchesReceipt("Cartão de Débito", "cartao_credito"),
    ).toBe(false);
    expect(
      paymentMethodMatchesReceipt("Cartão de Crédito", "cartao_debito"),
    ).toBe(false);
  });

  it("'Cartão' genérico, sem crédito/débito na descrição, casa com os dois tipos", () => {
    expect(paymentMethodMatchesReceipt("Cartão", "cartao_credito")).toBe(true);
    expect(paymentMethodMatchesReceipt("Cartão", "cartao_debito")).toBe(true);
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

  it("crédito 2x + 3x Master: cada comprovante bate parcelas e bandeira do seu pagamento", () => {
    const credit2x = { ...credit, installments: 2, card_brand: 2 };
    const credit3x = { ...credit, installments: 3, card_brand: 2 };
    const card = (installments: number, cardBrand: string) => ({
      ...receipt("cartao_credito"),
      installments,
      cardBrand,
    });

    expect(
      paymentMethodsMatchReceipts(
        [credit2x, credit3x],
        [card(2, "MASTERCARD"), card(3, "Master Card")],
      ),
    ).toBe(true);
    // comprovante de 5x não corresponde a nenhum dos pagamentos
    expect(
      paymentMethodsMatchReceipts(
        [credit2x, credit3x],
        [card(5, "MASTERCARD")],
      ),
    ).toBe(false);
    // bandeira diferente
    expect(paymentMethodsMatchReceipts([credit2x], [card(2, "VISA")])).toBe(
      false,
    );
  });

  it("parcelas/bandeira ausentes de um lado não pesam no match", () => {
    expect(
      paymentMethodsMatchReceipts(
        [{ ...credit, installments: 2, card_brand: 2 }],
        [{ ...receipt("cartao_credito"), installments: null, cardBrand: null }],
      ),
    ).toBe(true);
    expect(
      paymentMethodsMatchReceipts(
        [{ ...credit, installments: 2, card_brand: null }],
        [
          {
            ...receipt("cartao_credito"),
            installments: 2,
            cardBrand: "Bandeira X",
          },
        ],
      ),
    ).toBe(true);
  });

  it("bandeira do comprovante por palavra-chave (acento/espaço/caixa ignorados)", () => {
    const card = (cardBrand: string) => ({ ...receipt("cartao_credito"), installments: 1, cardBrand });
    const brand = (code: number) => [{ ...credit, installments: 1, card_brand: code }];
    expect(paymentMethodsMatchReceipts(brand(1), [card("visa electron")])).toBe(true);
    expect(paymentMethodsMatchReceipts(brand(3), [card("American Express")])).toBe(true);
    expect(paymentMethodsMatchReceipts(brand(3), [card("AMEX")])).toBe(true);
    expect(paymentMethodsMatchReceipts(brand(6), [card("Elo")])).toBe(true);
    expect(paymentMethodsMatchReceipts(brand(7), [card("Hipercard")])).toBe(true);
    expect(paymentMethodsMatchReceipts(brand(5), [card("Diners Club International")])).toBe(true);
    expect(paymentMethodsMatchReceipts(brand(2), [card("Elo")])).toBe(false);
  });

  it("débito 1x com comprovante de débito sem parcelas: bate", () => {
    const debit = method("3", "Cartão de Débito");
    expect(
      paymentMethodsMatchReceipts(
        [{ ...debit, installments: 1, card_brand: 1 }],
        [{ ...receipt("cartao_debito"), installments: null, cardBrand: "VISA" }],
      ),
    ).toBe(true);
  });

  it("forma escolhida no comprovante (id) + parcelas diferentes: não bate", () => {
    expect(
      paymentMethodsMatchReceipts(
        [{ ...credit, installments: 3, card_brand: 2 }],
        [{ ...receipt(null, "2"), installments: 2, cardBrand: "MASTERCARD" }],
      ),
    ).toBe(false);
  });

  it("dois pagamentos e um comprovante só: falta comprovante pro outro pagamento", () => {
    expect(
      paymentMethodsMatchReceipts(
        [
          { ...credit, installments: 2, card_brand: 2 },
          { ...credit, installments: 3, card_brand: 2 },
        ],
        [{ ...receipt("cartao_credito"), installments: 2, cardBrand: "MASTERCARD" }],
      ),
    ).toBe(false);
  });
});
