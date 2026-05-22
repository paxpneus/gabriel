import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import SalesReportService from "./sales-report.service";

export class SalesReportQueue extends BaseQueueService<void> {
  constructor(options: { workless?: boolean } = {}) {
    super("SALES_REPORT", {
      concurrency: 1,
      workless: options.workless,
    });
  }

  async process(job: Job<void, void, string>): Promise<void> {
    console.log(`[SalesReportQueue] Iniciando job ${job.id}`);
    const result = await SalesReportService.runIncrementalJob();
    console.log(
      `[SalesReportQueue] Finalizado: ${result.ordersProcessed} pedidos processados`,
    );
  }
}
