// Redis em memória: cachedReport grava/lê o relatório aqui (sem conexão real, o Jest sai).
const store = new Map<string, unknown>();
jest.mock("../../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => void store.set(key, value)),
  },
}));
jest.mock("../../../../config/sequelize", () => ({ __esModule: true, default: { query: jest.fn() } }));

import sequelize from "../../../../config/sequelize";
import { AffiliatesReportRepository } from "../affiliates-report.repository";
import { AffiliatesReportService } from "../affiliates-report.service";
import { AffiliatesReportRow } from "../affiliates-report.types";

const row = (overrides: Partial<AffiliatesReportRow>): AffiliatesReportRow => ({
  affiliated_id: "aff-1",
  affiliated_name: "Afiliado A",
  coupon_codes: "CUPOM10",
  sales_count: 0,
  items_sold_count: "0",
  total_sold: "0",
  profit: "0",
  affiliated_comission: "0",
  orders_not_invoiced: 0,
  ...overrides,
});

describe("AffiliatesReportService", () => {
  const repository = { findAffiliateTotals: jest.fn() };
  const service = new AffiliatesReportService(repository as any);
  const params = { startDate: "2026-10-01", endDate: "2026-10-31" };

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    repository.findAffiliateTotals.mockResolvedValue([]);
  });

  it("converte os números de cada afiliado e soma o summary em centavos (sem resíduo de float)", async () => {
    repository.findAffiliateTotals.mockResolvedValue([
      row({ sales_count: 2, items_sold_count: "3.0000", total_sold: "0.10", profit: "0.20", affiliated_comission: "0.10", orders_not_invoiced: 1 }),
      row({ affiliated_id: "aff-2", affiliated_name: "Afiliado B", sales_count: "1", items_sold_count: "1.5000", total_sold: "0.20", profit: "-0.05", affiliated_comission: "0.20" }),
    ]);

    const report = await service.getReport(params);

    expect(report.affiliates[0]).toEqual({
      affiliated_id: "aff-1",
      affiliated_name: "Afiliado A",
      coupon_codes: "CUPOM10",
      sales_count: 2,
      items_sold_count: 3,
      total_sold: 0.1,
      profit: 0.2,
      affiliated_comission: 0.1,
      orders_not_invoiced: 1,
    });
    expect(report.summary).toEqual({
      affiliates_count: 2,
      affiliates_with_sales: 2,
      sales_count: 3,
      items_sold_count: 4.5,
      total_sold: 0.3,
      profit: 0.15,
      affiliated_comission: 0.3,
      orders_not_invoiced: 1,
    });
  });

  it("afiliado sem venda no período aparece zerado e não conta em affiliates_with_sales", async () => {
    repository.findAffiliateTotals.mockResolvedValue([row({ coupon_codes: null })]);

    const report = await service.getReport(params);

    expect(report.affiliates).toHaveLength(1);
    expect(report.affiliates[0]).toMatchObject({ sales_count: 0, total_sold: 0, affiliated_comission: 0, coupon_codes: null });
    expect(report.summary).toMatchObject({ affiliates_count: 1, affiliates_with_sales: 0, total_sold: 0 });
  });

  it("repassa o filtro de afiliado e ecoa em filters (null sem filtro)", async () => {
    const withFilter = await service.getReport({ ...params, affiliatedIds: ["aff-1"] });
    expect(repository.findAffiliateTotals).toHaveBeenCalledWith({ ...params, affiliatedIds: ["aff-1"] });
    expect(withFilter.filters).toEqual({ start_date: "2026-10-01", end_date: "2026-10-31", affiliated_id: ["aff-1"] });

    const withoutFilter = await service.getReport(params);
    expect(withoutFilter.filters.affiliated_id).toBeNull();
  });

  it("getCachedReport usa o cache de 1h; refresh recalcula e regrava", async () => {
    const first = await service.getCachedReport(params);
    await service.getCachedReport(params);
    expect(repository.findAffiliateTotals).toHaveBeenCalledTimes(1);
    expect(first.cache.cached_at).toEqual(expect.any(String));
    expect([...store.keys()][0]).toMatch(/^report:affiliates-report:/);

    await service.getCachedReport(params, true);
    expect(repository.findAffiliateTotals).toHaveBeenCalledTimes(2);
  });
});

describe("AffiliatesReportRepository.findAffiliateTotals", () => {
  const query = sequelize.query as jest.Mock;
  const repository = new AffiliatesReportRepository();

  beforeEach(() => query.mockReset().mockResolvedValue([]));

  it("lê os snapshots do sales report (todos os pedidos, inclusive sem vendedor), só venda válida, e lista todos os afiliados", async () => {
    await repository.findAffiliateTotals({ startDate: "2026-10-01", endDate: "2026-10-31" });

    const [sql, options] = query.mock.calls[0];
    expect(sql).toContain("FROM sales_order_item_snapshots sois");
    expect(sql).not.toContain("seller_sales_order_item_snapshots");
    expect(sql).toContain("sos.snapshot_status = 'completed'");
    expect(sql).toContain("SUM(sois.contribution_value)");
    expect(sql).toContain("SUM(sois.affiliated_commission_value)");
    expect(sql).toContain("FROM contacts ct\n      LEFT JOIN sales s");
    expect(sql).not.toContain(":affiliatedIds");
    expect(options.replacements).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-31", affiliatedType: "AFFILIATED" });
  });

  it("filtro de afiliado restringe as vendas e a lista de contatos", async () => {
    await repository.findAffiliateTotals({ startDate: "2026-10-01", endDate: "2026-10-31", affiliatedIds: ["aff-1"] });

    const [sql, options] = query.mock.calls[0];
    expect(sql).toContain("AND sos.affiliated_id IN (:affiliatedIds)");
    expect(sql).toContain("AND ct.id IN (:affiliatedIds)");
    expect(options.replacements.affiliatedIds).toEqual(["aff-1"]);
  });
});
