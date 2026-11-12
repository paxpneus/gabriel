import { Job, UnrecoverableError } from "bullmq";
import { BaseQueueService } from "../../shared/utils/base-models/base-queue-service";
import SellerSalesReportService from "./sellers-report/seller-report/seller-sales-report.service";
import SalesReportService from "./daily-sales/sales-report/sales-report.service";
import DailyOperationReportService from "./daily-operation/daily-operation-report/daily-operation-report.service";

// Relatórios com base própria, na ordem em que o "hourly" enfileira (Map preserva a ordem): seller → sales → daily operation.
const REPORT_TASKS = new Map<string, () => Promise<unknown>>([
  ["seller-sales-report", () => SellerSalesReportService.runIncrementalJob()],
  ["sales-report", () => SalesReportService.runIncrementalJob()],
  ["daily-operation", () => DailyOperationReportService.runIncrementalJob()],
]);

// Task do repeat de 1h: só enfileira um job por relatório.
export const REPORT_HOURLY_TASK = "hourly";

export interface ReportJobData {
  task: string;
}

// Fila única dos relatórios com base própria; concurrency 1 + FIFO: nunca rodam dois juntos.
export class ReportQueue extends BaseQueueService<ReportJobData> {
  constructor(options: { workless?: boolean } = {}) {
    super("REPORT", {
      concurrency: 1,
      workless: options.workless,
    });
  }

  // "hourly" faz fan-out (um job por relatório: retry/falha próprios no BullBoard); as demais rodam o relatório.
  async process(job: Job<ReportJobData>): Promise<void> {
    const { task } = job.data;

    if (task === REPORT_HOURLY_TASK) {
      // jobId com a hora (UTC, YYYYMMDDHH): repeat que dispara de novo na mesma hora não duplica o pendente.
      const hour = new Date().toISOString().slice(0, 13).replace(/\D/g, "");
      // Em sequência e sem priority: entram na ordem na lista "wait" comum (FIFO).
      for (const reportTask of REPORT_TASKS.keys()) {
        await this.add({ task: reportTask }, `report-${reportTask}-${hour}`, {
          name: reportTask,
        });
      }
      return;
    }

    const run = REPORT_TASKS.get(task);
    if (!run) {
      throw new UnrecoverableError(`[ReportQueue] Task desconhecida: ${task}`);
    }

    console.log(`[ReportQueue] Iniciando ${task} (job ${job.id})`);
    await run();
    console.log(`[ReportQueue] ${task} finalizado`);
  }
}
