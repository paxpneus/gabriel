import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class BlingMigrationQueue extends BaseQueueService<void> {
  constructor(options: { workless?: boolean } = {}) {
    super("BLING_MIGRATION", {
      concurrency: 1,
         lockDuration: 12 * 60 * 60 * 1000, 
      workless: options.workless,
    });
  }

  async process(job: Job<void, void, string>): Promise<void> {
    console.log(`[BlingMigrationQueue] Rodando script de migração... jobId=${job.id}`);

    try {
      const { stdout, stderr } = await execFileAsync("node", [
        "dist/scripts/bling/populate-from-bling.js",
      ]);

      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);

      console.log(`[BlingMigrationQueue] Script concluído em ${new Date().toISOString()}`);
    } catch (err) {
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Bling — migração diária falhou",
        message: `Erro ao executar script: ${err}`,
      });
      throw err;
    }
  }
}
