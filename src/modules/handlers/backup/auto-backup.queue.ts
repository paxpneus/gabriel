import { Job } from "bullmq";
import { BaseQueueService } from "../../../shared/utils/base-models/base-queue-service";
import autoBackupService from "./auto-backup.service";

export class AutoBackupQueue extends BaseQueueService<void> {
  constructor(options: { workless?: boolean } = {}) {
    super("AUTO_BACKUP", {
      concurrency: 1,
      lockDuration: 30 * 60 * 1000,
      workless: options.workless,
    });
  }

  async process(job: Job<void, void, string>): Promise<void> {
    console.log(`[AutoBackupQueue] Iniciando backup do banco. jobId=${job.id}`);

    const result = await autoBackupService.run();

    console.log(
      `[AutoBackupQueue] Backup enviado: ${result.path} (${result.size} bytes)`,
    );
  }
}
