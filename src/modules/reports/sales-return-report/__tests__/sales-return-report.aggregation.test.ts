import {
  buildReportRows,
  buildSummary,
  movementsWithoutInvoice,
} from "../services/main/sales-return-report/sales-return-report.aggregation";
import { SalesReturnLineRow } from "../models/sales-return-report.types";

function line(overrides: Partial<SalesReturnLineRow>): SalesReturnLineRow {
  return {
    movement_id: "m1",
    return_invoice_id: "r1",
    return_invoice_number: "900",
    return_date: "2026-05-10",
    sku: "SKU",
    description: "Desc item",
    quantity: "2.0000",
    total_value: "200.00",
    has_price: true,
    product_name: "Pneu X",
    brand: "Marca Y",
    sale_invoice_number: "500",
    order_id: "o1",
    order_number_system: "123",
    order_date: "2026-05-01",
    store_name: "Loja 21",
    seller_name: "Vendedor",
    customer_name: "Cliente Z",
    sales_channel: "MercadoLivre",
    ...overrides,
  };
}

describe("buildReportRows", () => {
  it("mapeia o item devolvido e repete totais da nota de devolução", () => {
    const rows = buildReportRows([
      line({}),
      line({ movement_id: "m2", quantity: "1.0000", total_value: "80.00" }),
    ]);

    expect(rows[0]).toEqual({
      movement_id: "m1",
      return_invoice_id: "r1",
      return_invoice_number: "900",
      return_date: "2026-05-10",
      order_id: "o1",
      store_name: "Loja 21",
      order_date: "2026-05-01",
      order_number: "123",
      seller_name: "Vendedor",
      customer_name: "Cliente Z",
      sales_channel: "MercadoLivre",
      invoice_number: "500",
      brand: "Marca Y",
      product: "Pneu X",
      sku: "SKU",
      quantity: 2,
      total_value: 200,
      order_total_value: 280,
      volumes: 3,
      has_price: true,
    });
    expect(rows[1].order_total_value).toBe(280);
  });

  it("movimento sem nota achada não se agrupa com outro", () => {
    const rows = buildReportRows([
      line({ movement_id: "m1", return_invoice_id: null }),
      line({ movement_id: "m2", return_invoice_id: null }),
    ]);
    expect(rows[0].volumes).toBe(2);
    expect(rows[1].volumes).toBe(2);
  });

  it("valor Bling (4 casas) arredonda só na saída", () => {
    const [row] = buildReportRows([line({ total_value: "339.9775" })]);
    expect(row.total_value).toBe(339.98);
  });

  it("sem pedido mantém a devolução com campos da venda nulos e nome da nota", () => {
    const [row] = buildReportRows([
      line({
        order_id: null, order_number_system: null, order_date: null, store_name: null, seller_name: null,
        product_name: null,
      }),
    ]);
    expect(row.order_id).toBeNull();
    expect(row.product).toBe("Desc item");
    expect(row.total_value).toBe(200);
  });
});

describe("buildSummary", () => {
  it("soma quantidade e valor devolvidos e conta notas de devolução", () => {
    const summary = buildSummary([
      line({}),
      line({ return_invoice_id: "r2", has_price: false, total_value: "0" }),
    ]);

    expect(summary).toEqual({
      orders_count: 2,
      items_quantity: 4,
      total_volumes: 4,
      gross_revenue: 200,
      lines_without_price: 1,
    });
  });

  it("soma o valor em 4 casas antes de arredondar, como o stock flow", () => {
    const summary = buildSummary([
      line({ total_value: "0.0050" }),
      line({ return_invoice_id: "r2", total_value: "0.0050" }),
    ]);
    expect(summary.gross_revenue).toBe(0.01);
  });

  it("sem linhas zera tudo", () => {
    expect(buildSummary([])).toEqual({
      orders_count: 0,
      items_quantity: 0,
      total_volumes: 0,
      gross_revenue: 0,
      lines_without_price: 0,
    });
  });
});

describe("movementsWithoutInvoice", () => {
  it("conta notas dos movimentos sem nota no sistema, uma vez por número", () => {
    const warning = movementsWithoutInvoice([
      line({}),
      line({ movement_id: "m2", return_invoice_id: null, return_invoice_number: "777" }),
      line({ movement_id: "m3", return_invoice_id: null, return_invoice_number: "777" }),
      line({ movement_id: "m4", return_invoice_id: null, return_invoice_number: null }),
    ]);
    expect(warning).toEqual({ count: 2, invoice_numbers: ["777"] });
  });
});
