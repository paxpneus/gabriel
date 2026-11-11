jest.mock("../sales-report.repository", () => ({
  __esModule: true,
  salesReportRepository: {
    getCheckpoint: jest.fn(),
    markRunning: jest.fn(),
    heartbeat: jest.fn(),
    markSuccess: jest.fn(),
    markFailed: jest.fn(),
    findAffectedOrderIds: jest.fn(),
    findAffectedFactKeys: jest.fn(),
    findAffectedStateFactKeys: jest.fn(),
    findAffectedStoreFactKeys: jest.fn(),
    findAffectedProductFactKeys: jest.fn(),
    findAffectedStatusFactKeys: jest.fn(),
    upsertSnapshots: jest.fn(),
    updateSnapshotTotals: jest.fn(),
    upsertDailySalesFacts: jest.fn(),
    upsertDailySalesStateFacts: jest.fn(),
    upsertDailySalesStoreFacts: jest.fn(),
    upsertDailySalesProductFacts: jest.fn(),
    upsertDailySalesStatusFacts: jest.fn(),
    deleteOrphanFacts: jest.fn(),
    getSupplierDiscountRetroCheckpoint: jest.fn(),
    findOrderIdsAffectedBySupplierDiscountRuleChanges: jest.fn(),
    reapplySupplierDiscountsForOrderIds: jest.fn(),
    markSupplierDiscountRetroCheckpointSuccess: jest.fn(),
  },
}));

// Sem mock, a invalidação do cache faz SCAN no Redis real e a conexão aberta não deixa o Jest sair.
jest.mock("../../../helpers/report-cache", () => ({
  __esModule: true,
  cachedReport: jest.fn(),
  invalidateReportCache: jest.fn(),
  REPORT_CACHE_NAMES: {
    salesReport: "sales-report",
    salesInvoicedReport: "sales-invoiced-report",
    affiliatesReport: "affiliates-report",
    affiliatedReport: "affiliated-report",
  },
}));

import { salesReportRepository } from "../sales-report.repository";
import { SalesReportService } from "../sales-report.service";
import { invalidateReportCache } from "../../../helpers/report-cache";

const repo = salesReportRepository as unknown as Record<string, jest.Mock>;

const factKey = (date: string) => ({
  fact_date: date,
  unit_business_id: "ub-1",
  integration_id: "int-1",
  status_normalized: null,
});

describe("SalesReportService.runIncrementalJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repo.getCheckpoint.mockResolvedValue(new Date("2024-01-01"));
    repo.markRunning.mockResolvedValue(true);
    repo.deleteOrphanFacts.mockResolvedValue(0);
    repo.getSupplierDiscountRetroCheckpoint.mockResolvedValue(new Date());
    repo.findOrderIdsAffectedBySupplierDiscountRuleChanges.mockResolvedValue([]);
    for (const name of [
      "findAffectedStateFactKeys",
      "findAffectedStoreFactKeys",
      "findAffectedProductFactKeys",
      "findAffectedStatusFactKeys",
    ]) {
      repo[name].mockResolvedValue([]);
    }
  });

  it("recusa quando outro job detém o lock ativo, sem marcar falha", async () => {
    repo.markRunning.mockResolvedValue(false);

    await expect(new SalesReportService().runIncrementalJob()).rejects.toThrow(
      "Job já está em execução",
    );
    expect(repo.findAffectedOrderIds).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it("processa snapshots em lotes com heartbeat e grava facts uma vez, sem chave repetida", async () => {
    const orderIds = Array.from({ length: 1200 }, (_, i) => `order-${i}`);
    repo.findAffectedOrderIds.mockResolvedValue(orderIds);
    repo.findAffectedFactKeys.mockResolvedValue([factKey("2026-05-01")]);

    const result = await new SalesReportService().runIncrementalJob();

    expect(repo.upsertSnapshots).toHaveBeenCalledTimes(3);
    expect(repo.upsertSnapshots.mock.calls[0][0]).toHaveLength(500);
    expect(repo.upsertSnapshots.mock.calls[2][0]).toHaveLength(200);
    expect(repo.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(repo.upsertDailySalesFacts).toHaveBeenCalledTimes(1);
    expect(repo.upsertDailySalesFacts.mock.calls[0][0]).toEqual([
      factKey("2026-05-01"),
    ]);
    expect(repo.markSuccess).toHaveBeenCalledWith(expect.any(Date), 1200);
    expect(result.ordersProcessed).toBe(1200);
    // Snapshots mudaram: cache do sales report, do faturado e dos dois relatórios de afiliado (mesmos snapshots) é invalidado no fim do job.
    expect(invalidateReportCache).toHaveBeenCalledWith(
      "sales-report",
      "sales-invoiced-report",
      "affiliates-report",
      "affiliated-report",
    );
  });
});
