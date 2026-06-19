import { SalesReportRepository } from "./sales-report.repository";
import { SalesReportFilters } from "./sales-report.types";

// ---------------------------------------------------------------------------
// Minimal BaseService contract — adapt to whatever your project exports
// ---------------------------------------------------------------------------
// If you already have a BaseService with logger / error handling, extend it
// here instead. This keeps the service self-contained until then.
// ---------------------------------------------------------------------------

export class SalesReportService {
  constructor(private readonly repo: SalesReportRepository) {}

  // -------------------------------------------------------------------------
  // Main pipeline — called by the scheduler / job runner
  // -------------------------------------------------------------------------

  async run(): Promise<{ rowsProcessed: number }> {
    const jobStartTime = new Date();

    await this.repo.markRunning();

    try {
      const lastProcessedAt = await this.repo.getCheckpoint();
      const orderIds = await this.repo.findAffectedOrderIds(lastProcessedAt);

      if (!orderIds.length) {
        await this.repo.markSuccess(jobStartTime, 0);
        return { rowsProcessed: 0 };
      }

      // 1. Snapshots (heavy CTE upsert)
      await this.repo.upsertSnapshots(orderIds);

      // 2. Discover which fact-table keys were touched
      const [factKeys, stateKeys, storeKeys, productKeys, statusKeys] =
        await Promise.all([
          this.repo.findAffectedFactKeys(orderIds),
          this.repo.findAffectedStateFactKeys(orderIds),
          this.repo.findAffectedStoreFactKeys(orderIds),
          this.repo.findAffectedProductFactKeys(orderIds),
          this.repo.findAffectedStatusFactKeys(orderIds),
        ]);

      // 3. Upsert all fact tables (sequential — avoids connection exhaustion
      //    on large batches; flip to Promise.all if your pool can handle it)
      await this.repo.upsertDailySalesFacts(factKeys);
      await this.repo.upsertDailySalesStateFacts(stateKeys);
      await this.repo.upsertDailySalesStoreFacts(storeKeys);
      await this.repo.upsertDailySalesProductFacts(productKeys);
      await this.repo.upsertDailySalesStatusFacts(statusKeys);

      await this.repo.markSuccess(jobStartTime, orderIds.length);

      return { rowsProcessed: orderIds.length };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.repo.markFailed(error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // On-demand re-processing for specific orders (e.g. backfill command)
  // -------------------------------------------------------------------------

  async reprocessOrders(orderIds: string[]): Promise<void> {
    if (!orderIds.length) return;

    await this.repo.upsertSnapshots(orderIds);
    await this.repo.updateSnapshotTotals(orderIds);

    const [factKeys, stateKeys, storeKeys, productKeys, statusKeys] =
      await Promise.all([
        this.repo.findAffectedFactKeys(orderIds),
        this.repo.findAffectedStateFactKeys(orderIds),
        this.repo.findAffectedStoreFactKeys(orderIds),
        this.repo.findAffectedProductFactKeys(orderIds),
        this.repo.findAffectedStatusFactKeys(orderIds),
      ]);

    await this.repo.upsertDailySalesFacts(factKeys);
    await this.repo.upsertDailySalesStateFacts(stateKeys);
    await this.repo.upsertDailySalesStoreFacts(storeKeys);
    await this.repo.upsertDailySalesProductFacts(productKeys);
    await this.repo.upsertDailySalesStatusFacts(statusKeys);
  }

  // -------------------------------------------------------------------------
  // Read API — forwarded straight to repo (no extra logic here)
  // -------------------------------------------------------------------------

  async getReport(filters: SalesReportFilters) {
    return this.repo.getReport(filters);
  }

  async getJobStatus() {
    return this.repo.getJobStatus();
  }
}

// Singleton for use in controllers / schedulers
import { salesReportRepository } from "./sales-report.repository";
export const salesReportService = new SalesReportService(salesReportRepository);