import {
  DailyOperationJobResult,
  DailyOperationReportFilters,
} from "./daily-operation-report.types";
import { dailyOperationReportRepository } from "./daily-operation-report.repository";

const JOB_NAME = "daily_operation_report";

export class DailyOperationReportService {
  async runIncrementalJob(): Promise<DailyOperationJobResult> {
    const jobStartTime = new Date();
    const lastProcessedAt =
      await dailyOperationReportRepository.getCheckpoint();

    try {
      await dailyOperationReportRepository.markRunning();

      const invoiceIds =
        await dailyOperationReportRepository.findAffectedInvoiceIds(
          lastProcessedAt,
        );

      const previousFactKeys =
        await dailyOperationReportRepository.findAffectedFactKeys(invoiceIds);
      const previousTransporterFactKeys =
        await dailyOperationReportRepository.findAffectedTransporterFactKeys(
          invoiceIds,
        );

      await dailyOperationReportRepository.upsertSnapshots(invoiceIds);

      const currentFactKeys =
        await dailyOperationReportRepository.findAffectedFactKeys(invoiceIds);
      const factKeys = this.uniqueFactKeys([
        ...previousFactKeys,
        ...currentFactKeys,
      ]);
      await dailyOperationReportRepository.upsertDailyOperationFacts(factKeys);

      const currentTransporterFactKeys =
        await dailyOperationReportRepository.findAffectedTransporterFactKeys(
          invoiceIds,
        );
      const transporterFactKeys = this.uniqueTransporterFactKeys([
        ...previousTransporterFactKeys,
        ...currentTransporterFactKeys,
      ]);
      await dailyOperationReportRepository.upsertDailyTransporterFacts(
        transporterFactKeys,
      );

      await dailyOperationReportRepository.markSuccess(
        jobStartTime,
        invoiceIds.length,
      );

      return {
        jobName: JOB_NAME,
        startedAt: jobStartTime,
        lastProcessedAt,
        invoicesProcessed: invoiceIds.length,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await dailyOperationReportRepository.markFailed(err);
      throw err;
    }
  }

  async getReport(filters: DailyOperationReportFilters) {
    if (!filters.date) {
      throw new Error("Data obrigatória.");
    }

    return dailyOperationReportRepository.getReport(filters);
  }

  private uniqueFactKeys<T extends { fact_date: string; unit_business_id: string }>(
    keys: T[],
  ): T[] {
    return Array.from(
      new Map(
        keys.map((key) => [`${key.fact_date}:${key.unit_business_id}`, key]),
      ).values(),
    );
  }

  private uniqueTransporterFactKeys<
    T extends {
      fact_date: string;
      unit_business_id: string;
      transporter_id: string;
    },
  >(keys: T[]): T[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.unit_business_id}:${key.transporter_id}`,
          key,
        ]),
      ).values(),
    );
  }
}

export default new DailyOperationReportService();
