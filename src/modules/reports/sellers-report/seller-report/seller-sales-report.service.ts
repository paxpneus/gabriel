import {
  AffectedSellerCustomerFactKey,
  AffectedSellerProductFactKey,
  SellerSalesReportFilters,
} from "./seller-sales-report.types";
import { sellerSalesReportRepository } from "./seller-sales-report.repository";

const JOB_NAME = "seller_sales_report";

export interface SellerSalesReportJobResult {
  jobName: string;
  startedAt: Date;
  lastProcessedAt: Date;
  ordersProcessed: number;
}

export class SellerSalesReportService {
  async runIncrementalJob(): Promise<SellerSalesReportJobResult> {
    const status = await sellerSalesReportRepository.getJobStatus();
    if (status?.status === "running") {
      throw new Error("Job já está em execução, aguarde.");
    }

    const jobStartTime = new Date();
    const lastProcessedAt = await sellerSalesReportRepository.getCheckpoint();

    try {
      await sellerSalesReportRepository.markRunning();

      const orderIds =
        await sellerSalesReportRepository.findAffectedOrderIds(
          lastProcessedAt,
        );

      const previousProductFactKeys =
        await sellerSalesReportRepository.findAffectedSellerProductFactKeys(
          orderIds,
        );
      const previousCustomerFactKeys =
        await sellerSalesReportRepository.findAffectedSellerCustomerFactKeys(
          orderIds,
        );

      await sellerSalesReportRepository.upsertSnapshots(orderIds);

      const currentProductFactKeys =
        await sellerSalesReportRepository.findAffectedSellerProductFactKeys(
          orderIds,
        );
      const currentCustomerFactKeys =
        await sellerSalesReportRepository.findAffectedSellerCustomerFactKeys(
          orderIds,
        );

      await sellerSalesReportRepository.upsertDailySellerProductFacts(
        this.uniqueProductFactKeys([
          ...previousProductFactKeys,
          ...currentProductFactKeys,
        ]),
      );
      await sellerSalesReportRepository.upsertDailySellerCustomerFacts(
        this.uniqueCustomerFactKeys([
          ...previousCustomerFactKeys,
          ...currentCustomerFactKeys,
        ]),
      );

      await sellerSalesReportRepository.markSuccess(
        jobStartTime,
        orderIds.length,
      );

      return {
        jobName: JOB_NAME,
        startedAt: jobStartTime,
        lastProcessedAt,
        ordersProcessed: orderIds.length,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await sellerSalesReportRepository.markFailed(err);
      throw err;
    }
  }

  async getJobStatus() {
    return sellerSalesReportRepository.getJobStatus();
  }

  async getReport(filters: SellerSalesReportFilters) {
    if (!filters.startDate || !filters.endDate) {
      throw new Error("startDate e endDate são obrigatórios.");
    }

    return sellerSalesReportRepository.getReport(filters);
  }

  private uniqueProductFactKeys(
    keys: AffectedSellerProductFactKey[],
  ): AffectedSellerProductFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.seller_id}:${key.product_id}`,
          key,
        ]),
      ).values(),
    );
  }

  private uniqueCustomerFactKeys(
    keys: AffectedSellerCustomerFactKey[],
  ): AffectedSellerCustomerFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.seller_id}:${key.customer_id}`,
          key,
        ]),
      ).values(),
    );
  }
}

export default new SellerSalesReportService();