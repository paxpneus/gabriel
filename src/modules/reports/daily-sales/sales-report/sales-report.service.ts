import {
  SalesFactKey,
  SalesProductFactKey,
  SalesReportFilters,
  SalesReportJobResult,
  SalesStateFactKey,
  SalesStatusFactKey,
  SalesStoreFactKey,
} from "./sales-report.types";
import { salesReportRepository } from "./sales-report.repository";

const JOB_NAME = "sales_report";

export class SalesReportService {
  async runIncrementalJob(): Promise<SalesReportJobResult> {
    const status = await salesReportRepository.getJobStatus();
    if (status?.status === "running") {
      throw new Error("Job já está em execução, aguarde.");
    }

    const jobStartTime = new Date();
    const lastProcessedAt = await salesReportRepository.getCheckpoint();

    try {
      await salesReportRepository.markRunning();

      const orderIds =
        await salesReportRepository.findAffectedOrderIds(lastProcessedAt);

      const previousFactKeys =
        await salesReportRepository.findAffectedFactKeys(orderIds);
      const previousStateFactKeys =
        await salesReportRepository.findAffectedStateFactKeys(orderIds);
      const previousStoreFactKeys =
        await salesReportRepository.findAffectedStoreFactKeys(orderIds);
      const previousProductFactKeys =
        await salesReportRepository.findAffectedProductFactKeys(orderIds);
      const previousStatusFactKeys =
        await salesReportRepository.findAffectedStatusFactKeys(orderIds);

      await salesReportRepository.upsertSnapshots(orderIds);
      await salesReportRepository.updateSnapshotTotals(orderIds);

      const currentFactKeys =
        await salesReportRepository.findAffectedFactKeys(orderIds);
      const currentStateFactKeys =
        await salesReportRepository.findAffectedStateFactKeys(orderIds);
      const currentStoreFactKeys =
        await salesReportRepository.findAffectedStoreFactKeys(orderIds);
      const currentProductFactKeys =
        await salesReportRepository.findAffectedProductFactKeys(orderIds);
      const currentStatusFactKeys =
        await salesReportRepository.findAffectedStatusFactKeys(orderIds);

      await salesReportRepository.upsertDailySalesFacts(
        this.uniqueFactKeys([...previousFactKeys, ...currentFactKeys]),
      );
      await salesReportRepository.upsertDailySalesStateFacts(
        this.uniqueStateFactKeys([
          ...previousStateFactKeys,
          ...currentStateFactKeys,
        ]),
      );
      await salesReportRepository.upsertDailySalesStoreFacts(
        this.uniqueStoreFactKeys([
          ...previousStoreFactKeys,
          ...currentStoreFactKeys,
        ]),
      );
      await salesReportRepository.upsertDailySalesProductFacts(
        this.uniqueProductFactKeys([
          ...previousProductFactKeys,
          ...currentProductFactKeys,
        ]),
      );
      await salesReportRepository.upsertDailySalesStatusFacts(
        this.uniqueStatusFactKeys([
          ...previousStatusFactKeys,
          ...currentStatusFactKeys,
        ]),
      );

      await salesReportRepository.markSuccess(jobStartTime, orderIds.length);

      return {
        jobName: JOB_NAME,
        startedAt: jobStartTime,
        lastProcessedAt,
        ordersProcessed: orderIds.length,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await salesReportRepository.markFailed(err);
      throw err;
    }
  }

  async getJobStatus() {
    return salesReportRepository.getJobStatus();
  }

  async getReport(filters: SalesReportFilters) {
    if (!filters.dateFrom || !filters.dateTo) {
      throw new Error("dateFrom e dateTo são obrigatórios.");
    }

    return salesReportRepository.getReport(filters);
  }

  private uniqueFactKeys(keys: SalesFactKey[]): SalesFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [`${key.fact_date}:${key.unit_business_id}`, key]),
      ).values(),
    );
  }

  private uniqueStateFactKeys(keys: SalesStateFactKey[]): SalesStateFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.unit_business_id}:${key.destination_uf}`,
          key,
        ]),
      ).values(),
    );
  }

  private uniqueStoreFactKeys(keys: SalesStoreFactKey[]): SalesStoreFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.unit_business_id}:${key.store_id}`,
          key,
        ]),
      ).values(),
    );
  }

  private uniqueProductFactKeys(
    keys: SalesProductFactKey[],
  ): SalesProductFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.unit_business_id}:${key.sku}`,
          key,
        ]),
      ).values(),
    );
  }

  private uniqueStatusFactKeys(
    keys: SalesStatusFactKey[],
  ): SalesStatusFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.unit_business_id}:${key.status_id}`,
          key,
        ]),
      ).values(),
    );
  }
}

export default new SalesReportService();
