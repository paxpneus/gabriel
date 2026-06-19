import { SalesReportService } from "../sales-report.service";
import { SalesReportRepository } from "../sales-report.repository";
import {
  SalesFactKey,
  SalesProductFactKey,
  SalesReportFilters,
  SalesStateFactKey,
  SalesStatusFactKey,
  SalesStoreFactKey,
} from "../sales-report.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORDER_A = "00000000-0000-0000-0000-000000000001";
const ORDER_B = "00000000-0000-0000-0000-000000000002";
const UNIT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const STORE_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const INT_ID = "cccccccc-0000-0000-0000-000000000001";

const FACT_KEY: SalesFactKey = {
  fact_date: new Date("2024-01-15"),
  unit_business_id: UNIT_ID,
};
const STATE_KEY: SalesStateFactKey = {
  ...FACT_KEY,
  destination_uf: "SP",
};
const STORE_KEY: SalesStoreFactKey = {
  ...FACT_KEY,
  store_id: STORE_ID,
};
const PRODUCT_KEY: SalesProductFactKey = {
  ...FACT_KEY,
  sku: "SKU-001",
};
const STATUS_KEY: SalesStatusFactKey = {
  ...FACT_KEY,
  integration_id: INT_ID,
  status_normalized: "delivered",
};

/** Builds a fully-mocked repository. Every method is a jest.fn() returning
 *  safe defaults so individual tests only need to override what they care about. */
function buildRepo(): jest.Mocked<SalesReportRepository> {
  return {
    getCheckpoint: jest.fn().mockResolvedValue(new Date("2024-01-14T00:00:00Z")),
    ensureCheckpoint: jest.fn().mockResolvedValue(undefined),
    markRunning: jest.fn().mockResolvedValue(undefined),
    markSuccess: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    getJobStatus: jest.fn().mockResolvedValue({
      status: "success",
      last_run_at: new Date(),
      last_processed_at: new Date(),
      rows_processed: 0,
      metadata: null,
    }),
    findAffectedOrderIds: jest.fn().mockResolvedValue([ORDER_A, ORDER_B]),
    findAffectedFactKeys: jest.fn().mockResolvedValue([FACT_KEY]),
    findAffectedStateFactKeys: jest.fn().mockResolvedValue([STATE_KEY]),
    findAffectedStoreFactKeys: jest.fn().mockResolvedValue([STORE_KEY]),
    findAffectedProductFactKeys: jest.fn().mockResolvedValue([PRODUCT_KEY]),
    findAffectedStatusFactKeys: jest.fn().mockResolvedValue([STATUS_KEY]),
    upsertSnapshots: jest.fn().mockResolvedValue(undefined),
    updateSnapshotTotals: jest.fn().mockResolvedValue(undefined),
    upsertDailySalesFacts: jest.fn().mockResolvedValue(undefined),
    upsertDailySalesStateFacts: jest.fn().mockResolvedValue(undefined),
    upsertDailySalesStoreFacts: jest.fn().mockResolvedValue(undefined),
    upsertDailySalesProductFacts: jest.fn().mockResolvedValue(undefined),
    upsertDailySalesStatusFacts: jest.fn().mockResolvedValue(undefined),
    getReport: jest.fn().mockResolvedValue({
      period: { dateFrom: "2024-01-01", dateTo: "2024-01-31" },
      general: {},
      byState: [],
      byProduct: [],
      byUnitBusiness: [],
      byStatus: [],
    }),
  } as unknown as jest.Mocked<SalesReportRepository>;
}

// ---------------------------------------------------------------------------
// Tests: run()
// ---------------------------------------------------------------------------

describe("SalesReportService.run()", () => {
  it("marks job as running before any processing", async () => {
    const repo = buildRepo();
    const service = new SalesReportService(repo);

    await service.run();

    expect(repo.markRunning).toHaveBeenCalledTimes(1);
    // markRunning must precede upsertSnapshots
    const runningOrder = repo.markRunning.mock.invocationCallOrder[0];
    const snapshotOrder = repo.upsertSnapshots.mock.invocationCallOrder[0];
    expect(runningOrder).toBeLessThan(snapshotOrder);
  });

  it("returns rowsProcessed = 0 and skips pipeline when no affected orders", async () => {
    const repo = buildRepo();
    repo.findAffectedOrderIds.mockResolvedValue([]);
    const service = new SalesReportService(repo);

    const result = await service.run();

    expect(result.rowsProcessed).toBe(0);
    expect(repo.upsertSnapshots).not.toHaveBeenCalled();
    expect(repo.upsertDailySalesFacts).not.toHaveBeenCalled();
    expect(repo.markSuccess).toHaveBeenCalledTimes(1);
  });

  it("runs full pipeline in correct order when orders exist", async () => {
    const repo = buildRepo();
    const service = new SalesReportService(repo);
    const callOrder: string[] = [];

    // Track call order for pipeline sequencing assertions
    repo.upsertSnapshots.mockImplementation(async () => { callOrder.push("upsertSnapshots"); });
    repo.findAffectedFactKeys.mockImplementation(async () => { callOrder.push("findKeys"); return [FACT_KEY]; });
    repo.upsertDailySalesFacts.mockImplementation(async () => { callOrder.push("upsertFacts"); });
    repo.markSuccess.mockImplementation(async () => { callOrder.push("markSuccess"); });

    await service.run();

    expect(callOrder[0]).toBe("upsertSnapshots");
    expect(callOrder).toContain("upsertFacts");
    expect(callOrder[callOrder.length - 1]).toBe("markSuccess");
  });

  it("returns correct rowsProcessed count", async () => {
    const repo = buildRepo();
    repo.findAffectedOrderIds.mockResolvedValue([ORDER_A, ORDER_B]);
    const service = new SalesReportService(repo);

    const result = await service.run();

    expect(result.rowsProcessed).toBe(2);
    expect(repo.markSuccess).toHaveBeenCalledWith(expect.any(Date), 2);
  });

  it("upserts all five fact tables when orders exist", async () => {
    const repo = buildRepo();
    const service = new SalesReportService(repo);

    await service.run();

    expect(repo.upsertDailySalesFacts).toHaveBeenCalledWith([FACT_KEY]);
    expect(repo.upsertDailySalesStateFacts).toHaveBeenCalledWith([STATE_KEY]);
    expect(repo.upsertDailySalesStoreFacts).toHaveBeenCalledWith([STORE_KEY]);
    expect(repo.upsertDailySalesProductFacts).toHaveBeenCalledWith([PRODUCT_KEY]);
    expect(repo.upsertDailySalesStatusFacts).toHaveBeenCalledWith([STATUS_KEY]);
  });

  it("calls markFailed (not markSuccess) when pipeline throws", async () => {
    const repo = buildRepo();
    const boom = new Error("db exploded");
    repo.upsertSnapshots.mockRejectedValue(boom);
    const service = new SalesReportService(repo);

    await expect(service.run()).rejects.toThrow("db exploded");

    expect(repo.markFailed).toHaveBeenCalledWith(boom);
    expect(repo.markSuccess).not.toHaveBeenCalled();
  });

  it("wraps non-Error throws into an Error before calling markFailed", async () => {
    const repo = buildRepo();
    repo.upsertSnapshots.mockRejectedValue("string error");
    const service = new SalesReportService(repo);

    await expect(service.run()).rejects.toThrow("string error");

    const [passedError] = repo.markFailed.mock.calls[0];
    expect(passedError).toBeInstanceOf(Error);
    expect(passedError.message).toBe("string error");
  });

  it("re-throws the error after marking failed so the caller knows", async () => {
    const repo = buildRepo();
    repo.upsertSnapshots.mockRejectedValue(new Error("boom"));
    const service = new SalesReportService(repo);

    await expect(service.run()).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// Tests: reprocessOrders()
// ---------------------------------------------------------------------------

describe("SalesReportService.reprocessOrders()", () => {
  it("is a no-op for empty array", async () => {
    const repo = buildRepo();
    const service = new SalesReportService(repo);

    await service.reprocessOrders([]);

    expect(repo.upsertSnapshots).not.toHaveBeenCalled();
    expect(repo.updateSnapshotTotals).not.toHaveBeenCalled();
  });

  it("calls upsertSnapshots then updateSnapshotTotals in order", async () => {
    const repo = buildRepo();
    const service = new SalesReportService(repo);
    const callOrder: string[] = [];

    repo.upsertSnapshots.mockImplementation(async () => { callOrder.push("upsertSnapshots"); });
    repo.updateSnapshotTotals.mockImplementation(async () => { callOrder.push("updateSnapshotTotals"); });

    await service.reprocessOrders([ORDER_A]);

    expect(callOrder[0]).toBe("upsertSnapshots");
    expect(callOrder[1]).toBe("updateSnapshotTotals");
  });

  it("passes the correct orderIds to each repo method", async () => {
    const repo = buildRepo();
    const service = new SalesReportService(repo);
    const ids = [ORDER_A, ORDER_B];

    await service.reprocessOrders(ids);

    expect(repo.upsertSnapshots).toHaveBeenCalledWith(ids);
    expect(repo.updateSnapshotTotals).toHaveBeenCalledWith(ids);
    expect(repo.findAffectedFactKeys).toHaveBeenCalledWith(ids);
  });

  it("upserts all five fact tables", async () => {
    const repo = buildRepo();
    const service = new SalesReportService(repo);

    await service.reprocessOrders([ORDER_A]);

    expect(repo.upsertDailySalesFacts).toHaveBeenCalledTimes(1);
    expect(repo.upsertDailySalesStateFacts).toHaveBeenCalledTimes(1);
    expect(repo.upsertDailySalesStoreFacts).toHaveBeenCalledTimes(1);
    expect(repo.upsertDailySalesProductFacts).toHaveBeenCalledTimes(1);
    expect(repo.upsertDailySalesStatusFacts).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: getReport()
// ---------------------------------------------------------------------------

describe("SalesReportService.getReport()", () => {
  const filters: SalesReportFilters = {
    dateFrom: "2024-01-01",
    dateTo: "2024-01-31",
  };

  it("delegates to repo.getReport with filters untouched", async () => {
    const repo = buildRepo();
    const service = new SalesReportService(repo);

    await service.getReport(filters);

    expect(repo.getReport).toHaveBeenCalledWith(filters);
  });

  it("returns whatever the repo returns", async () => {
    const repo = buildRepo();
    const expected = {
      period: { dateFrom: "2024-01-01", dateTo: "2024-01-31" },
      general: { orders_count: 42, total_value: "9999.00" },
      byState: [{ destination_uf: "SP", orders_count: 10 }],
      byProduct: [],
      byUnitBusiness: [],
      byStatus: [],
    };
    repo.getReport.mockResolvedValue(expected as any);
    const service = new SalesReportService(repo);

    const result = await service.getReport(filters);

    expect(result).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Tests: getJobStatus()
// ---------------------------------------------------------------------------

describe("SalesReportService.getJobStatus()", () => {
  it("delegates to repo.getJobStatus", async () => {
    const repo = buildRepo();
    const service = new SalesReportService(repo);

    await service.getJobStatus();

    expect(repo.getJobStatus).toHaveBeenCalledTimes(1);
  });

  it("returns null when no checkpoint exists", async () => {
    const repo = buildRepo();
    repo.getJobStatus.mockResolvedValue(null);
    const service = new SalesReportService(repo);

    const result = await service.getJobStatus();

    expect(result).toBeNull();
  });

  it("returns checkpoint data when it exists", async () => {
    const repo = buildRepo();
    const checkpoint = {
      status: "failed",
      last_run_at: new Date("2024-01-15T10:00:00Z"),
      last_processed_at: new Date("2024-01-14T00:00:00Z"),
      rows_processed: 0,
      metadata: { error: "timeout" },
    };
    repo.getJobStatus.mockResolvedValue(checkpoint);
    const service = new SalesReportService(repo);

    const result = await service.getJobStatus();

    expect(result).toEqual(checkpoint);
  });
});