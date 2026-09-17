import { spawn } from "child_process";
import { Dirent, promises as fs } from "fs";
import path from "path";
import { Job } from "bullmq";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { SCRAPING_SHARED_QUEUE_LOCK } from "./scraping-queue-lock";

const CSV_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Roda um script Node filho transmitindo stdout/stderr linha a linha pro
 * console do processo pai em tempo real. Usado no lugar de
 * execFile/execFileAsync, que bufferizam a saída inteira em memória e só a
 * entregam quando o processo filho termina — nesse caso específico
 * (extração que roda por horas, com uma linha de progresso por
 * produto/depósito) isso deixa o `docker logs` mudo durante toda a
 * execução, sem forma de saber se está travado ou só demorando, e ainda
 * arrisca estourar `maxBuffer` num run completo com muitas linhas.
 */
function runWithLiveLogs(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env ?? process.env });

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} saiu com código ${code}`));
    });
  });
}
const CSV_STORAGE_DIR = path.resolve(
  process.env.STOCK_MOVEMENTS_CSV_DIR ?? "./data/stock-movements",
);
const AUTO_POPULATE = process.env.BLING_STOCK_MOVEMENTS_AUTO_POPULATE === "true";
const AUTO_POPULATE_DRY_RUN =
  process.env.BLING_STOCK_MOVEMENTS_POPULATE_DRY_RUN !== "false";

/**
 * Executa a extração diária do CSV de lançamentos de estoque da Bling.
 */
export class BlingStockMovementsScrapingQueue extends BaseQueueService<void> {
  constructor(options: { workless?: boolean } = {}) {
    super("BLING_STOCK_MOVEMENTS_SCRAPING", {
      concurrency: 1,
      lockDuration: 12 * 60 * 60 * 1000,
      maxProcessingMs: 15 * 60 * 60 * 1000,
      sharedLock: SCRAPING_SHARED_QUEUE_LOCK,
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

      await runWithLiveLogs("node", ["dist/scripts/bling/get-stock-movements.js"]);

      if (AUTO_POPULATE) {
        console.log(
          `[BlingStockMovementsScrapingQueue] Iniciando populate automático (DRY_RUN=${AUTO_POPULATE_DRY_RUN})...`,
        );

        await runWithLiveLogs(
          "node",
          ["dist/scripts/bling/populate-stock-movements.js"],
          {
            // Não permite que um CSV_PATH legado aponte para outro arquivo
            // (ou diretório). Sem override, o populate usa a fonte recém
            // registrada pelo scraper.
            env: {
              ...process.env,
              CSV_PATH: "",
              DRY_RUN: AUTO_POPULATE_DRY_RUN ? "true" : "false",
            },
          },
        );
      } else {
        console.log(
          "[BlingStockMovementsScrapingQueue] Populate automático desabilitado.",
        );
      }

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
