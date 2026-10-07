import {
  buildReportRows,
  buildSummary,
  computeOrderVolumes,
} from "../services/main/sales-invoiced-report/sales-invoiced-report.aggregation";
import { SalesInvoicedItemRow } from "../models/sales-invoiced-report.types";

const NO_INVOICE = { id: null, number_system: null, total_expected: null };

function item(
  overrides: Partial<SalesInvoicedItemRow> & {
    order_id: string;
    invoice?: SalesInvoicedItemRow["orderSnapshot"]["invoice"];
  },
): SalesInvoicedItemRow {
  const { order_id, invoice, ...rest } = overrides;
  return {
    order_item_id: "oi",
    sku: "SKU",
    description: "Desc item",
    quantity: "1.0000",
    kit_multiplier: "1.0000",
    net_total: "100.00",
    net_value: "70.00",
    average_cost_snapshot: "50.0000",
    total_cost_snapshot: "52.00",
    contribution_value: "20.00",
    orderSnapshot: {
      order_id,
      order_number_system: "123",
      order_date: "2026-05-10",
      total_products: "300.00",
      net_value: "210.00",
      total_cost: "152.00",
      contribution_value: "64.00",
      unitBusiness: { name: "Loja 21" },
      invoice: invoice ?? NO_INVOICE,
      seller: { name: "Vendedor" },
    },
    product: { name: "Pneu X", brandRegister: { name: "Marca Y" } },
    ...rest,
  };
}

describe("computeOrderVolumes", () => {
  it("com nota usa total_expected da nota", () => {
    const volumes = computeOrderVolumes([
      item({
        order_id: "o1",
        quantity: "2.0000",
        invoice: { id: "inv-1", number_system: "555", total_expected: "7" },
      }),
    ]);
    expect(volumes.get("o1")).toBe(7);
  });

  it("sem nota soma quantity × kit_multiplier (kit de 4 + 1 unitário = 5)", () => {
    const volumes = computeOrderVolumes([
      item({ order_id: "o2", quantity: "1.0000", kit_multiplier: "4.0000" }),
      item({ order_id: "o2", quantity: "1.0000", kit_multiplier: "1.0000" }),
    ]);
    expect(volumes.get("o2")).toBe(5);
  });

  it("kit_multiplier nulo conta como 1", () => {
    const volumes = computeOrderVolumes([
      item({ order_id: "o3", quantity: "3.0000", kit_multiplier: null }),
    ]);
    expect(volumes.get("o3")).toBe(3);
  });
});

describe("buildReportRows", () => {
  it("mapeia colunas e repete volumes/custo do pedido na linha", () => {
    const rows = buildReportRows(
      [item({ order_id: "o1" })],
      new Map([["o1", 5]]),
    );
    expect(rows[0]).toEqual({
      order_id: "o1",
      store_name: "Loja 21",
      order_date: "2026-05-10",
      order_number: "123",
      seller_name: "Vendedor",
      invoice_number: null,
      brand: "Marca Y",
      product: "Pneu X",
      sku: "SKU",
      quantity: 1,
      total_value: 100,
      net_value: 70,
      unit_cost: 50,
      item_total_cost: 52,
      order_total_value: 300,
      order_net_value: 210,
      order_total_cost: 152,
      profit: 20,
      order_profit: 64,
      volumes: 5,
    });
  });

  it("sem produto vinculado cai na descrição do item", () => {
    const rows = buildReportRows(
      [item({ order_id: "o1", product: null })],
      new Map(),
    );
    expect(rows[0].product).toBe("Desc item");
    expect(rows[0].brand).toBeNull();
  });
});

describe("buildSummary", () => {
  it("converte totais e soma volumes por pedido", () => {
    const summary = buildSummary(
      {
        orders_count: 2,
        items_quantity: "3.0000",
        gross_revenue: "300.00",
        total_discount: "10.00",
        total_net_value: "200.00",
        total_marketplace_fees: "30.00",
        total_freight: "20.00",
        total_taxes: "36.00",
        total_commission: "4.00",
        total_cost: "150.00",
        total_supplier_discount: "0.00",
        contribution_value: "64.00",
        contribution_pct: "21.33",
        markup_pct: "100.00",
        average_ticket: "150.00",
      },
      new Map([
        ["o1", 5],
        ["o2", 2.5],
      ]),
    );
    expect(summary.total_volumes).toBe(7.5);
    expect(summary.contribution_value).toBe(64);
    expect(summary.contribution_pct).toBe(21.33);
    expect(summary.orders_count).toBe(2);
  });

  it("sem totais devolve zeros", () => {
    const summary = buildSummary(null, new Map());
    expect(summary.gross_revenue).toBe(0);
    expect(summary.total_volumes).toBe(0);
  });
});
