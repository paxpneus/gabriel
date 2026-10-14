import {
  buildReportRows,
  buildSummary,
} from "../services/main/sale-transfer-invoice-report/sale-transfer-invoice-report.aggregation";

describe("sale transfer invoice report aggregation", () => {
  const rows = buildReportRows([
    {
      id: "inv-1",
      number_system: "1001",
      emitted_at: new Date("2026-10-01T13:00:00Z"),
      transfer_invoice_number: "55",
      transfer_invoice_emitted_at: new Date("2026-10-02T15:00:00Z"),
      transfer_invoice_status: "OPEN",
      total_expected: "4.0000",
      order: { number_order_system: "9001" },
      originUnitBusiness: { id: "ub-store", name: "Loja 12", number: "12" },
      unitBusinessAttributes: { status: "FINISHED", unitBusiness: { id: "ub-cd21", name: "CD 21", number: "21" } },
    },
    {
      id: "inv-2",
      number_system: "1002",
      emitted_at: null,
      transfer_invoice_number: null,
      transfer_invoice_emitted_at: null,
      transfer_invoice_status: null,
      total_expected: "2",
      order: { number_order_system: null },
      originUnitBusiness: { id: null, name: null, number: null },
      unitBusinessAttributes: { status: "OPEN", unitBusiness: { id: "ub-cd21", name: "CD 21", number: "21" } },
    },
  ]);

  it("mapeia nota de venda, transferência, pedido, quantidade e lojas (origem sem join vira null)", () => {
    const cd21 = { id: "ub-cd21", name: "CD 21", number: "21" };
    expect(rows).toEqual([
      {
        invoice_id: "inv-1", sale_invoice_number: "1001", sale_invoice_emitted_at: new Date("2026-10-01T13:00:00Z"), status: "FINISHED", transfer_invoice_number: "55", transfer_invoice_emitted_at: new Date("2026-10-02T15:00:00Z"),
        transfer_invoice_status: "OPEN", order_number: "9001", quantity: 4,
        origin_unit_business: { id: "ub-store", name: "Loja 12", number: "12" }, unit_business: cd21,
      },
      {
        invoice_id: "inv-2", sale_invoice_number: "1002", sale_invoice_emitted_at: null, status: "OPEN", transfer_invoice_number: null, transfer_invoice_emitted_at: null,
        transfer_invoice_status: null, order_number: null, quantity: 2,
        origin_unit_business: null, unit_business: cd21,
      },
    ]);
  });

  it("resume notas, notas com transferência e quantidade total", () => {
    expect(buildSummary(rows)).toEqual({
      invoices_count: 2,
      with_transfer_count: 1,
      total_quantity: 6,
    });
  });
});
