import {
  buildReportRows,
  buildSummary,
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
    brand_name: "Marca Y",
    sale_invoice_number: "500",
    order_id: "o1",
    order_number_system: "123",
    order_date: "2026-05-01",
    store_name: "Loja 21",
    seller_name: "Vendedor",
    customer_name: "Cliente Z",
    has_sale_item: true,
    net_value: "150.00",
    total_cost: "121.00",
    contribution_value: "29.00",
    discount_value: "10.00",
    tax_commission: "20.00",
    freight_cost: "5.00",
    computed_icms_value: "12.00",
    commission_value: "3.00",
    supplier_discount_value: "1.00",
    ...overrides,
  };
}

describe("buildReportRows", () => {
  it("mapeia o item devolvido e repete totais da nota de devolução", () => {
    const rows = buildReportRows([
      line({}),
      line({ quantity: "1.0000", total_value: "80.00", net_value: "60.00", total_cost: "50.00", contribution_value: "10.00" }),
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
      invoice_number: "500",
      brand: "Marca Y",
      product: "Pneu X",
      sku: "SKU",
      quantity: 2,
      total_value: 200,
      net_value: 150,
      unit_cost: 60.5,
      item_total_cost: 121,
      order_total_value: 280,
      order_net_value: 210,
      order_total_cost: 171,
      profit: 29,
      order_profit: 39,
      volumes: 3,
      has_price: true,
      has_sale_item: true,
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

  it("sem pedido/item vendido mantém a devolução com valores da venda zerados", () => {
    const [row] = buildReportRows([
      line({
        order_id: null, order_number_system: null, order_date: null, store_name: null, seller_name: null,
        product_name: null, has_sale_item: false, net_value: "0", total_cost: "0", contribution_value: "0",
      }),
    ]);
    expect(row.order_id).toBeNull();
    expect(row.product).toBe("Desc item");
    expect(row.total_value).toBe(200);
    expect(row.unit_cost).toBe(0);
    expect(row.has_sale_item).toBe(false);
  });
});

describe("buildSummary", () => {
  it("soma linhas, conta notas de devolução e calcula percentuais", () => {
    const summary = buildSummary([
      line({}),
      line({ return_invoice_id: "r2", has_sale_item: false, has_price: false, total_value: "100.00", net_value: "0", total_cost: "0", contribution_value: "0" }),
    ]);

    expect(summary.orders_count).toBe(2);
    expect(summary.items_quantity).toBe(4);
    expect(summary.total_volumes).toBe(4);
    expect(summary.gross_revenue).toBe(300);
    expect(summary.total_net_value).toBe(150);
    expect(summary.total_cost).toBe(121);
    expect(summary.contribution_value).toBe(29);
    expect(summary.contribution_pct).toBe(9.67);
    expect(summary.markup_pct).toBe(147.93);
    expect(summary.average_ticket).toBe(150);
    expect(summary.total_discount).toBe(20);
    expect(summary.total_marketplace_fees).toBe(40);
    expect(summary.lines_without_sale_item).toBe(1);
    expect(summary.lines_without_price).toBe(1);
  });

  it("soma o valor em 4 casas antes de arredondar, como o stock flow", () => {
    const summary = buildSummary([
      line({ total_value: "0.0050" }),
      line({ return_invoice_id: "r2", total_value: "0.0050" }),
    ]);
    expect(summary.gross_revenue).toBe(0.01);
  });

  it("sem linhas zera tudo sem dividir por zero", () => {
    const summary = buildSummary([]);
    expect(summary.orders_count).toBe(0);
    expect(summary.contribution_pct).toBe(0);
    expect(summary.markup_pct).toBe(0);
    expect(summary.average_ticket).toBe(0);
  });
});
