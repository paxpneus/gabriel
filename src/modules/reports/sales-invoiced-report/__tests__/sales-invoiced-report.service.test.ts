import { SalesInvoicedReportService } from "../services/main/sales-invoiced-report/sales-invoiced-report.service";

jest.mock("../../../handlers/bling/api/bling_api.service", () => ({
  __esModule: true,
  getBlingIntegration: jest.fn().mockResolvedValue({ id: "int-bling" }),
}));

describe("SalesInvoicedReportService", () => {
  const repository = {
    findRows: jest.fn(),
    aggregateTotals: jest.fn(),
  };
  const service = new SalesInvoicedReportService(repository as any);

  beforeEach(() => {
    repository.findRows.mockResolvedValue([
      {
        order_item_id: "oi1",
        sku: "SKU",
        description: "Pneu",
        quantity: "2.0000",
        kit_multiplier: "1.0000",
        net_total: "200.00",
        net_value: "150.00",
        average_cost_snapshot: "60.0000",
        total_cost_snapshot: "121.00",
        contribution_value: "40.00",
        orderSnapshot: {
          order_id: "o1",
          order_number_system: "10",
          order_date: "2026-05-02",
          total_products: "200.00",
          net_value: "150.00",
          total_cost: "121.00",
          contribution_value: "40.00",
          unitBusiness: { name: "Loja 21" },
          invoice: { id: null, number_system: null, total_expected: null },
          seller: { name: "Ana" },
        },
        product: { name: "Pneu", brandRegister: { name: "Marca" } },
      },
    ]);
    repository.aggregateTotals.mockResolvedValue({
      orders_count: 1,
      gross_revenue: "200.00",
      contribution_value: "40.00",
      contribution_pct: "20.00",
    });
  });

  it("usa o mesmo filtro (Bling + status faturados + período) nas linhas e nos totais", async () => {
    await service.getReport({ startDate: "2026-05-01", endDate: "2026-05-31" });

    const expectedArgs = ["int-bling", "2026-05-01", "2026-05-31"];
    expect(repository.findRows).toHaveBeenCalledWith(...expectedArgs);
    expect(repository.aggregateTotals).toHaveBeenCalledWith(...expectedArgs);
  });

  it("monta linhas, volumes e resumo", async () => {
    const report = await service.getReport({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].volumes).toBe(2);
    expect(report.rows[0].net_value).toBe(150);
    expect(report.rows[0].order_total_value).toBe(200);
    expect(report.rows[0].order_net_value).toBe(150);
    expect(report.rows[0].order_profit).toBe(40);
    expect(report.summary.total_volumes).toBe(2);
    expect(report.summary.contribution_pct).toBe(20);
    expect(report.filters.statuses).not.toContain("EM_ABERTO");
  });
});
