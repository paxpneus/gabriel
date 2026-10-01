import {
  computePurchaseEntryDiscounts,
  DiscountHistoryRow,
} from "../helpers/purchase-entry-discount";
import {
  buildDiscountBulkUpdate,
  buildFillMissingInvoiceValuesUpdate,
} from "../helpers/invoice-value-updates";

function row(overrides: Partial<DiscountHistoryRow>): DiscountHistoryRow {
  return {
    id: "m",
    movement_type: "PURCHASE_ENTRY",
    direction: null,
    invoice_number: "100",
    refers_to: null,
    movement_quantity: 10,
    unit_cost_invoice: 100,
    balance_quantity: 10,
    resulting_average_cost: 100,
    total_stock_value: 1000,
    ...overrides,
  };
}

describe("computePurchaseEntryDiscounts", () => {
  it("entrada com ajuste: net = valor pós-ajuste - valor pré-entrada", () => {
    // pré: 5 un a 100 (500). Entrada 10 un a 100 bruto (1000) -> 1500.
    // Ajuste (qty 0) leva o CMP pra 96 -> 15 * 96 = 1440. net = 1440 - 500.
    const history = [
      row({
        id: "pre",
        movement_type: "SALE_OUT",
        invoice_number: "1",
        movement_quantity: 0,
        balance_quantity: 5,
        total_stock_value: 500,
      }),
      row({
        id: "entry",
        movement_quantity: 10,
        unit_cost_invoice: 100,
        balance_quantity: 15,
        total_stock_value: 1500,
      }),
      row({
        id: "adj",
        movement_type: "MANUAL_ADJUSTMENT",
        direction: "IN",
        invoice_number: null,
        refers_to: "100",
        movement_quantity: 0,
        balance_quantity: 15,
        resulting_average_cost: 96,
        total_stock_value: 1440,
      }),
    ];

    const result = computePurchaseEntryDiscounts(history);

    expect(result.withAdjustment).toBe(1);
    expect(result.withoutAdjustment).toBe(0);
    expect(result.anomalies).toEqual([]);
    expect(result.updates).toEqual([
      {
        id: "entry",
        gross_total_amount: "1000.0000",
        net_total_amount: "940.0000",
        unit_discount_amount: "6.0000",
        discount_amount: "60.0000",
        discount_percentage: "6.00",
      },
    ]);
  });

  it("entrada sem ajuste: net = qty * unit_cost_invoice, desconto zero", () => {
    const [update] = computePurchaseEntryDiscounts([row({ id: "entry" })]).updates;

    expect(update).toEqual({
      id: "entry",
      gross_total_amount: "1000.0000",
      net_total_amount: "1000.0000",
      unit_discount_amount: "0.0000",
      discount_amount: "0.0000",
      discount_percentage: "0.00",
    });
  });

  it("quantidade zero: não divide — unitário e percentual ficam NULL", () => {
    const [update] = computePurchaseEntryDiscounts([
      row({ id: "entry", movement_quantity: 0 }),
    ]).updates;

    expect(update.gross_total_amount).toBe("0.0000");
    expect(update.unit_discount_amount).toBeNull();
    expect(update.discount_percentage).toBeNull();
  });

  it("custo unitário zero (bruto 0): percentual NULL", () => {
    const [update] = computePurchaseEntryDiscounts([
      row({ id: "entry", unit_cost_invoice: 0 }),
    ]).updates;

    expect(update.gross_total_amount).toBe("0.0000");
    expect(update.discount_percentage).toBeNull();
  });

  it("sem unit_cost_invoice: grava NULL em tudo e sinaliza anomalia", () => {
    const result = computePurchaseEntryDiscounts([
      row({ id: "entry", unit_cost_invoice: null }),
    ]);

    expect(result.updates[0].net_total_amount).toBeNull();
    expect(result.anomalies.map((a) => a.kind)).toEqual(["missing_unit_cost"]);
  });

  it("mais de um ajuste pra mesma entrada: usa o último e sinaliza", () => {
    const history = [
      row({ id: "entry", total_stock_value: 1000 }),
      row({
        id: "adj1",
        movement_type: "MANUAL_ADJUSTMENT",
        direction: "IN",
        invoice_number: null,
        refers_to: "100",
        movement_quantity: 0,
        resulting_average_cost: 95,
        total_stock_value: 950,
      }),
      row({
        id: "adj2",
        movement_type: "MANUAL_ADJUSTMENT",
        direction: "IN",
        invoice_number: null,
        refers_to: "100",
        movement_quantity: 0,
        resulting_average_cost: 90,
        total_stock_value: 900,
      }),
    ];

    const result = computePurchaseEntryDiscounts(history);

    expect(result.updates[0].net_total_amount).toBe("900.0000");
    expect(result.anomalies.map((a) => a.kind)).toContain("multiple_adjustments");
  });

  it("ajuste com quantidade: isola só o efeito de custo e sinaliza", () => {
    // depois do ajuste: 12 un a 90 = 1080; 2 un entraram a 90 (=180) -> só 900 é custo
    const history = [
      row({ id: "entry", total_stock_value: 1000 }),
      row({
        id: "adj",
        movement_type: "MANUAL_ADJUSTMENT",
        direction: "IN",
        invoice_number: null,
        refers_to: "100",
        movement_quantity: 2,
        balance_quantity: 12,
        resulting_average_cost: 90,
        total_stock_value: 1080,
      }),
    ];

    const result = computePurchaseEntryDiscounts(history);

    expect(result.updates[0].net_total_amount).toBe("900.0000");
    expect(result.anomalies.map((a) => a.kind)).toContain(
      "adjustment_with_quantity",
    );
  });

  it("desconto negativo (ágio) e saldo anterior negativo são anomalias", () => {
    const history = [
      row({
        id: "pre",
        movement_type: "SALE_OUT",
        invoice_number: "1",
        movement_quantity: 0,
        balance_quantity: -2,
        total_stock_value: -200,
      }),
      row({ id: "entry", total_stock_value: 800 }),
      row({
        id: "adj",
        movement_type: "MANUAL_ADJUSTMENT",
        direction: "IN",
        invoice_number: null,
        refers_to: "100",
        movement_quantity: 0,
        resulting_average_cost: 130,
        total_stock_value: 1040,
      }),
    ];

    const kinds = computePurchaseEntryDiscounts(history).anomalies.map(
      (a) => a.kind,
    );

    expect(kinds).toEqual(
      expect.arrayContaining(["negative_previous_balance", "negative_discount"]),
    );
  });

  it("ajuste de outra nota não é associado à entrada", () => {
    const history = [
      row({ id: "entry", invoice_number: "100" }),
      row({
        id: "adj",
        movement_type: "MANUAL_ADJUSTMENT",
        direction: "IN",
        invoice_number: null,
        refers_to: "999",
        movement_quantity: 0,
        total_stock_value: 10,
      }),
    ];

    const result = computePurchaseEntryDiscounts(history);

    expect(result.withAdjustment).toBe(0);
    expect(result.updates[0].net_total_amount).toBe("1000.0000");
  });

  it("é determinística: mesma história, mesmo resultado", () => {
    const history = [
      row({ id: "entry" }),
      row({
        id: "adj",
        movement_type: "MANUAL_ADJUSTMENT",
        direction: "IN",
        invoice_number: null,
        refers_to: "100",
        movement_quantity: 0,
        resulting_average_cost: 95,
        total_stock_value: 950,
      }),
    ];

    expect(computePurchaseEntryDiscounts(history)).toEqual(
      computePurchaseEntryDiscounts(history),
    );
  });
});

describe("bulk update builders", () => {
  it("monta arrays alinhados e usa IS DISTINCT FROM (idempotente)", () => {
    const { sql, replacements } = buildDiscountBulkUpdate([
      {
        id: "a",
        gross_total_amount: "1.0000",
        net_total_amount: "1.0000",
        unit_discount_amount: null,
        discount_amount: "0.0000",
        discount_percentage: null,
      },
    ]);

    expect(sql).toContain("IS DISTINCT FROM");
    expect(replacements.ids).toEqual(["a"]);
    expect(replacements.unitDiscount).toEqual([null]);
  });

  it("fill-only usa COALESCE e nunca sobrescreve", () => {
    const { sql } = buildFillMissingInvoiceValuesUpdate([
      { id: "a", unit_price_invoice: "1.0000", bling_entry_ids: "1", bling_origin_id: "2" },
    ]);

    expect(sql).toContain("COALESCE(sm.unit_price_invoice, v.price)");
    expect(sql).toContain("sm.unit_price_invoice IS NULL");
  });
});
