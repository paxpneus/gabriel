import {
  buildReportRows,
  buildSummary,
  classifyInvoices,
  exclusionReason,
} from "../services/main/seller-commission-report/seller-commission-report.aggregation";
import {
  CommissionInvoiceRow,
  SellerCommissionItemRow,
} from "../models/seller-commission-report.types";

const invoice = (overrides: Partial<CommissionInvoiceRow> = {}): CommissionInvoiceRow => ({
  invoice_key: "inv-1",
  invoice_id: "inv-1",
  invoice_number: "1001",
  is_order_adjustment: false,
  movement_date: "2026-10-05",
  invoice_cancelled: false,
  has_return_invoice: false,
  has_return: false,
  return_invoice_number: null,
  order_id: "o1",
  order_number: "P1",
  seller_id: "s1",
  unit_business_id: "ub-1",
  has_seller: true,
  snapshot_items: 1,
  has_cost_data: true,
  is_valid_sale: true,
  ...overrides,
});

const item = (overrides: Partial<SellerCommissionItemRow> = {}): SellerCommissionItemRow => ({
  order_item_id: "oi1",
  order_id: "o1",
  order_date: "2026-10-04",
  order_number: "P1",
  store_name: "Loja 10",
  seller_name: "Vendedor A",
  manager_names: "Gerente A",
  customer_name: "Cliente",
  brand: "Marca",
  product_name: "Pneu",
  sku: "SKU1",
  quantity: "2.0000",
  net_total: "100.10",
  commission_base: "90.20",
  commission_rate: "0.5000",
  commission_value: "0.45",
  manager_commission_rate: "0.2500",
  manager_commission_value: "0.23",
  ...overrides,
});

describe("exclusionReason", () => {
  it.each([
    [{ invoice_id: null }, "movements_without_invoice"],
    [{ invoice_cancelled: true }, "cancelled_invoices_without_return"],
    [{ invoice_cancelled: true, has_return_invoice: true }, "cancelled_invoices_return_without_movement"],
    [{ order_id: null }, "invoices_without_order"],
    [{ has_seller: false }, "orders_without_seller"],
    [{ snapshot_items: 0, has_cost_data: null, is_valid_sale: null }, "orders_not_in_seller_report"],
    [{ has_cost_data: false, is_valid_sale: false }, "orders_missing_cost"],
    [{ is_valid_sale: false }, "orders_not_completed"],
    [{}, null],
  ])("%o → %s", (overrides, expected) => {
    expect(exclusionReason(invoice(overrides as Partial<CommissionInvoiceRow>))).toBe(expected);
  });

  it("ajuste do CSV não tem nota: segue pelo pedido", () => {
    expect(exclusionReason(invoice({ invoice_id: null, is_order_adjustment: true }))).toBeNull();
    expect(exclusionReason(invoice({ invoice_id: null, is_order_adjustment: true, order_id: null }))).toBe(
      "invoices_without_order",
    );
  });
});

describe("classifyInvoices", () => {
  it("separa pedidos que entram e conta avisos por motivo, incluindo nota sem movimento com vendedor", () => {
    const { includedByOrder, warnings } = classifyInvoices(
      [invoice(), invoice({ invoice_key: "inv-2", invoice_number: "1002", order_id: "o2", has_cost_data: false, is_valid_sale: false })],
      [{ invoice_number: "1003", emitted_date: "2026-10-03", order_id: "o3", order_number: "P3", seller_id: "s1", unit_business_id: "ub-1", has_seller: true }],
      {},
    );

    expect([...includedByOrder.keys()]).toEqual(["o1"]);
    expect(warnings.orders_missing_cost).toBe(1);
    expect(warnings.invoices_without_movement).toBe(1);
  });

  it("nota sem vendedor identificável (marketplace, sem pedido, nota inexistente) não conta aviso", () => {
    const { includedByOrder, warnings } = classifyInvoices(
      [
        invoice({ invoice_key: "inv-2", order_id: "o2", has_seller: false }),
        invoice({ invoice_key: "inv-3", order_id: null, has_seller: false }),
        invoice({ invoice_key: "inv-4", invoice_id: null, order_id: null, has_seller: false }),
        invoice({ invoice_key: "inv-5", order_id: "o5", has_seller: false, invoice_cancelled: true }),
      ],
      [
        { invoice_number: "1006", emitted_date: "2026-10-06", order_id: null, order_number: null, seller_id: null, unit_business_id: null, has_seller: false },
        { invoice_number: "1007", emitted_date: "2026-10-07", order_id: "o7", order_number: "P7", seller_id: "s0", unit_business_id: "ub-1", has_seller: false },
      ],
      {},
    );

    expect(includedByOrder.size).toBe(0);
    expect(Object.values(warnings).every((count) => count === 0)).toBe(true);
    expect(warnings).not.toHaveProperty("orders_without_seller");
    expect(warnings).not.toHaveProperty("invoices_without_order");
    expect(warnings).not.toHaveProperty("movements_without_invoice");
  });

  it("cancelada com devolução movimentada é ignorada; devolução sem movimento e sem devolução viram avisos distintos", () => {
    const { includedByOrder, warnings } = classifyInvoices(
      [
        invoice({ invoice_cancelled: true, has_return_invoice: true, has_return: true }),
        invoice({ invoice_key: "inv-2", invoice_number: "1002", order_id: "o2", invoice_cancelled: true }),
        invoice({
          invoice_key: "inv-3", invoice_number: "1003", order_id: "o3",
          invoice_cancelled: true, has_return_invoice: true,
        }),
      ],
      [],
      {},
    );

    expect(includedByOrder.size).toBe(0);
    expect(warnings.cancelled_invoices_without_return).toBe(1);
    expect(warnings.cancelled_invoices_return_without_movement).toBe(1);
  });

  it("filtro de vendedor/gerente tira do relatório e dos avisos o pedido de outra pessoa", () => {
    const { includedByOrder, warnings } = classifyInvoices(
      [
        invoice(),
        invoice({ invoice_key: "inv-2", order_id: "o2", seller_id: "s2", invoice_cancelled: true }),
        invoice({ invoice_key: "inv-3", order_id: "o3", seller_id: "s1", invoice_cancelled: true }),
      ],
      [{ invoice_number: "1004", emitted_date: "2026-10-04", order_id: "o4", order_number: "P4", seller_id: "s2", unit_business_id: "ub-1", has_seller: true }],
      { sellerIds: ["s1"], unitBusinessIds: ["ub-1"] },
    );

    expect([...includedByOrder.keys()]).toEqual(["o1"]);
    expect(warnings.cancelled_invoices_without_return).toBe(1);
    expect(warnings.invoices_without_movement).toBe(0);
  });
});

describe("buildReportRows / buildSummary", () => {
  it("linha leva nota e data do movimento; resumo soma comissões de vendedor e gerente", () => {
    const included = new Map([["o1", invoice()]]);
    const items = [item(), item({ order_item_id: "oi2", commission_value: "0.10", manager_commission_value: "0.07" })];

    const [row] = buildReportRows(items, included);
    expect(row).toMatchObject({
      invoice_number: "1001",
      movement_date: "2026-10-05",
      manager_name: "Gerente A",
      quantity: 2,
      total_value: 100.1,
      seller_commission_rate: 0.5,
      seller_commission_value: 0.45,
      manager_commission_value: 0.23,
    });
    expect(buildSummary(items)).toEqual({
      orders_count: 1,
      items_quantity: 4,
      total_value: 200.2,
      commission_base: 180.4,
      total_seller_commission: 0.55,
      total_manager_commission: 0.3,
    });
  });
});
