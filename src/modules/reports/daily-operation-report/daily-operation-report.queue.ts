import { Job } from "bullmq";
import { BaseQueueService } from "../../../shared/utils/base-models/base-queue-service";
import DailyOperationReportService from "./daily-operation-report.service";

export class DailyOperationReportQueue extends BaseQueueService<void> {
  constructor(options: { workless?: boolean } = {}) {
    super("DAILY_OPERATION_REPORT", {
      concurrency: 1,
      workless: options.workless,
    });
  }

  async process(job: Job<void, void, string>): Promise<void> {
    console.log(`[DailyOperationReportQueue] Iniciando job ${job.id}`);
    const result = await DailyOperationReportService.runIncrementalJob();
    console.log(
      `[DailyOperationReportQueue] Finalizado: ${result.invoicesProcessed} invoices processadas`,
    );
  }
}
