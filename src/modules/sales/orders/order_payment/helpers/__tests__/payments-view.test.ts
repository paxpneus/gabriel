import { toPaymentsView } from "../payments-view";

const credit = { id: "pm-credit", description: "Cartão de Crédito" };
const pix = { id: "pm-pix", description: "Pix" };

describe("toPaymentsView", () => {
  it("agrupa parcelas da mesma forma somando valor e contando parcelas", () => {
    const result = toPaymentsView([
      { amount: 151.85, due_date: "2026-11-03", paymentMethod: credit },
      { amount: 151.81, due_date: "2026-12-01", paymentMethod: credit },
      { amount: 151.81, due_date: "2026-12-31", paymentMethod: credit },
    ]);

    expect(result).toEqual([
      {
        paymentMethod: credit,
        detail: null,
        amount: 455.47,
        installments: 3,
        card_brand: null,
        card_brand_name: null,
        first_due_date: "2026-11-03",
        last_due_date: "2026-12-31",
      },
    ]);
  });

  it("mantém formas diferentes separadas, ordenadas pelo primeiro vencimento", () => {
    const result = toPaymentsView([
      { amount: 100, due_date: "2026-12-01", paymentMethod: credit },
      { amount: 50, due_date: "2026-10-01", paymentMethod: pix },
      { amount: 100, due_date: "2026-11-01", paymentMethod: credit },
    ]);

    expect(result.map((p) => p.paymentMethod?.description)).toEqual([
      "Pix",
      "Cartão de Crédito",
    ]);
    expect(result[1]).toMatchObject({ amount: 200, installments: 2 });
  });

  it("devolve lista vazia sem pagamentos", () => {
    expect(toPaymentsView(null)).toEqual([]);
    expect(toPaymentsView([])).toEqual([]);
  });

  it("no grupo Outros, informa o que é (nomes originais da Bling, distintos)", () => {
    const others = { id: "pm-other", id_system: "99", description: "Outros" };
    const result = toPaymentsView([
      {
        amount: 100,
        due_date: "2026-10-01",
        paymentMethod: others,
        form_description: "Mercado Pago",
      },
      {
        amount: 50,
        due_date: "2026-10-01",
        paymentMethod: others,
        form_description: "Mercado Pago",
      },
      {
        amount: 20,
        due_date: "2026-10-01",
        paymentMethod: others,
        form_description: "Vale Presente",
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      amount: 170,
      installments: 3,
      detail: "Mercado Pago, Vale Presente",
    });
  });

  it("fora do grupo Outros, não preenche detail mesmo com form_description", () => {
    const result = toPaymentsView([
      {
        amount: 100,
        due_date: "2026-10-01",
        paymentMethod: { ...credit, id_system: "3" },
        form_description: "Crédito Visa 2x",
      },
    ]);
    expect(result[0].detail).toBeNull();
  });

  it("separa crédito Master 2x e 3x da mesma forma do hub (pedido Bling com 5 parcelas)", () => {
    const row = (amount: number, due_date: string, installments: number) => ({
      amount,
      due_date,
      installments,
      card_brand: 2,
      paymentMethod: credit,
    });
    const result = toPaymentsView([
      row(844.11, "2026-12-07", 2),
      row(456.36, "2026-12-07", 3),
      row(844.11, "2027-01-05", 2),
      row(456.36, "2027-01-05", 3),
      row(456.38, "2027-02-03", 3),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        amount: 1688.22,
        installments: 2,
        card_brand: 2,
        card_brand_name: "Mastercard",
        last_due_date: "2027-01-05",
      }),
      expect.objectContaining({
        amount: 1369.1,
        installments: 3,
        last_due_date: "2027-02-03",
      }),
    ]);
  });

  it("mesma forma 2x usada em dois pagamentos vira dois itens de 2x", () => {
    const row = (amount: number, due_date: string) => ({
      amount,
      due_date,
      installments: 2,
      card_brand: 1,
      paymentMethod: credit,
    });
    const result = toPaymentsView([
      row(100, "2026-12-01"),
      row(200, "2026-12-01"),
      row(100, "2027-01-01"),
      row(200, "2027-01-01"),
    ]);

    expect(result.map((p) => [p.installments, p.amount])).toEqual([
      [2, 200],
      [2, 400],
    ]);
  });

  it("contagem que não fecha com as parcelas da forma fica num item só", () => {
    const result = toPaymentsView(
      ["2026-12-01", "2027-01-01", "2027-02-01"].map((due_date) => ({
        amount: 10,
        due_date,
        installments: 2,
        card_brand: 1,
        paymentMethod: credit,
      })),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ installments: 3, amount: 30 });
  });

  it("pedido antigo (sem installments/card_brand): agrupa só pela forma, como antes", () => {
    const result = toPaymentsView(
      [844.11, 456.36, 844.11, 456.36, 456.38].map((amount, index) => ({
        amount,
        due_date: `2026-1${index}-01`,
        paymentMethod: credit,
      })),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ installments: 5, amount: 3057.32, card_brand: null, card_brand_name: null });
  });

  it("mesma forma do hub com bandeiras diferentes (Visa 2x e Master 2x) vira dois itens", () => {
    const result = toPaymentsView([
      { amount: 50, due_date: "2026-12-01", installments: 2, card_brand: 1, paymentMethod: credit },
      { amount: 50, due_date: "2027-01-01", installments: 2, card_brand: 1, paymentMethod: credit },
      { amount: 70, due_date: "2026-12-01", installments: 2, card_brand: 2, paymentMethod: credit },
      { amount: 70, due_date: "2027-01-01", installments: 2, card_brand: 2, paymentMethod: credit },
    ]);
    expect(result.map((p) => [p.card_brand_name, p.amount])).toEqual([
      ["Visa", 100],
      ["Mastercard", 140],
    ]);
  });

  it("bandeira com código fora da lista: código vem, nome null", () => {
    const [item] = toPaymentsView([
      { amount: 10, due_date: "2026-12-01", installments: 1, card_brand: 42, paymentMethod: credit },
    ]);
    expect(item).toMatchObject({ card_brand: 42, card_brand_name: null });
  });

  it("cartão 1x usado duas vezes (dois cartões à vista) vira dois itens de 1x", () => {
    const result = toPaymentsView([
      { amount: 10, due_date: "2026-12-01", installments: 1, card_brand: 1, paymentMethod: credit },
      { amount: 20, due_date: "2026-12-01", installments: 1, card_brand: 1, paymentMethod: credit },
    ]);
    expect(result.map((p) => [p.installments, p.amount])).toEqual([
      [1, 10],
      [1, 20],
    ]);
  });

  it("forma sem cartão 'à vista' (boleto/dinheiro, condicao vazia) com parcelas lançadas à mão: um item só", () => {
    const boleto = { id: "pm-boleto", description: "Boleto Bancário" };
    const result = toPaymentsView(
      ["2026-12-01", "2027-01-01", "2027-02-01"].map((due_date) => ({
        amount: 100,
        due_date,
        installments: 1,
        card_brand: null,
        paymentMethod: boleto,
      })),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ installments: 3, amount: 300 });
  });

  it("parcela sem vencimento: datas ignoram null; sem forma (paymentMethod null) agrupa à parte", () => {
    const result = toPaymentsView([
      { amount: 10, due_date: null, installments: 2, card_brand: 1, paymentMethod: credit },
      { amount: 10, due_date: "2027-01-01", installments: 2, card_brand: 1, paymentMethod: credit },
      { amount: 5, due_date: "2026-12-01", paymentMethod: null },
    ]);
    const card = result.find((p) => p.paymentMethod?.id === credit.id)!;
    expect(card).toMatchObject({ first_due_date: "2027-01-01", last_due_date: "2027-01-01", installments: 2 });
    expect(result.find((p) => p.paymentMethod === null)).toMatchObject({ amount: 5 });
  });

  it("Outros com parcelas/bandeira diferentes: cada item lista só os nomes das suas linhas", () => {
    const others = { id: "pm-other", id_system: "99", description: "Outros" };
    const result = toPaymentsView([
      { amount: 10, due_date: "2026-10-01", installments: 1, paymentMethod: others, form_description: "Mercado Pago" },
      { amount: 20, due_date: "2026-10-02", installments: 3, paymentMethod: others, form_description: "Shopee" },
      { amount: 20, due_date: "2026-11-02", installments: 3, paymentMethod: others, form_description: "Shopee" },
      { amount: 20, due_date: "2026-12-02", installments: 3, paymentMethod: others, form_description: "Shopee" },
    ]);
    expect(result.map((p) => p.detail)).toEqual(["Mercado Pago", "Shopee"]);
  });
});
