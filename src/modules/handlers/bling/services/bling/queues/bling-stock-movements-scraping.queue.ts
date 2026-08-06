import { execFile } from "child_process";
import { promisify } from "util";
import { Job } from "bullmq";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { BLING_SHARED_QUEUE_LOCK } from "./bling-queue-lock";

const execFileAsync = promisify(execFile);

/**
 * Executa a extração diária do CSV de lançamentos de estoque da Bling.
 */
export class BlingStockMovementsScrapingQueue extends BaseQueueService<void> {
  constructor(options: { workless?: boolean } = {}) {
    super("BLING_STOCK_MOVEMENTS_SCRAPING", {
      concurrency: 1,
      lockDuration: 12 * 60 * 60 * 1000,
      maxProcessingMs: 15 * 60 * 60 * 1000,
      sharedLock: BLING_SHARED_QUEUE_LOCK,
      workless: options.workless,
    });
  }

  async process(job: Job<void, void, string>): Promise<void> {
    console.log(
      `[BlingStockMovementsScrapingQueue] Iniciando extração diária do CSV... jobId=${job.id}`,
    );

    try {
      const { stdout, stderr } = await execFileAsync(
        "node",
        ["dist/scripts/bling/get-stock-movements.js"],
        { maxBuffer: 10 * 1024 * 1024 },
      );

      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);

      console.log(
        `[BlingStockMovementsScrapingQueue] Extração concluída em ${new Date().toISOString()}`,
      );
    } catch (error) {
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Bling — extração diária de lançamentos de estoque falhou",
        message: `Erro ao executar get-stock-movements: ${error}`,
      });
      throw error;
    }
  }
}
