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
});
