import { Job } from 'bullmq';
import { BaseQueueService } from '../../../../shared/utils/base-models/base-queue-service';
import { alertService } from '../../../../shared/providers/mail-provider/nodemailer.alert';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class TCarMigrationQueue extends BaseQueueService<void> {
  constructor(options: { workless?: boolean } = {}) {
    super('TCAR_MIGRATION', {
      concurrency: 1,
      lockDuration: 12 * 60 * 60 * 1000,
      workless: options.workless,
    });
  }

  async process(job: Job<void, void, string>): Promise<void> {
    console.log(`[TCarMigrationQueue] Rodando script de migração... jobId=${job.id}`);

    try {
      const { stdout, stderr } = await execFileAsync('node', [
        'dist/scripts/tecinco/populate-from-tecinco.js',
      ]);

      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);

      console.log(`[TCarMigrationQueue] Script concluído em ${new Date().toISOString()}`);
    } catch (err) {
      alertService.sendAlert({
        severity: 'CRITICAL',
        title: 'TeCinco — migração falhou',
        message: `Erro ao executar script: ${err}`,
      });
      throw err;
    }
  }
}