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
});
