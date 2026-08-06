import { execFile } from "child_process";
import { Dirent, promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { Job } from "bullmq";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { BLING_SHARED_QUEUE_LOCK } from "./bling-queue-lock";

const execFileAsync = promisify(execFile);
const CSV_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CSV_STORAGE_DIR = path.resolve(
  process.env.STOCK_MOVEMENTS_CSV_DIR ?? "./data/stock-movements",
);

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

  /** Remove somente CSVs regulares já fora da retenção do volume. */
  private async removeExpiredCsvFiles(): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(CSV_STORAGE_DIR, { withFileTypes: true });
    } catch (error: any) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    const expirationTime = Date.now() - CSV_RETENTION_MS;
    let removed = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".csv")) {
        continue;
      }

      const filePath = path.join(CSV_STORAGE_DIR, entry.name);
      const metadata = await fs.stat(filePath);
      if (metadata.mtimeMs > expirationTime) continue;

      await fs.unlink(filePath);
      removed++;
      console.log(
        `[BlingStockMovementsScrapingQueue] CSV expirado removido: ${entry.name}`,
      );
    }

    if (removed > 0) {
      console.log(
        `[BlingStockMovementsScrapingQueue] Limpeza concluída: ${removed} CSV(s) removido(s).`,
      );
    }
  }

  async process(job: Job<void, void, string>): Promise<void> {
    console.log(
      `[BlingStockMovementsScrapingQueue] Iniciando extração diária do CSV... jobId=${job.id}`,
    );

    try {
      await this.removeExpiredCsvFiles();

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
