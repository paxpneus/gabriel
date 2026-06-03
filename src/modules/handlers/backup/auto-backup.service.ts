import { downloadDatabaseDump } from "../../../shared/utils/database/database-dump";
import uploaderService from "../uploader/services/uploader.service";

const DEFAULT_BACKUP_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export type AutoBackupResult = {
  filename: string;
  database: string;
  size: number;
  path: string;
  created_at: string;
};

export class AutoBackupService {
  async run(): Promise<AutoBackupResult> {
    const dump = await downloadDatabaseDump();
    const path = await uploaderService.upload({
      buffer: dump.buffer,
      filename: dump.filename,
      mimeType: dump.mimeType,
      directory: "/backups",
      preserveFilename: true,
      timeoutMs: this.getUploadTimeoutMs(),
    });

    return {
      filename: dump.filename,
      database: dump.database,
      size: dump.size,
      path,
      created_at: new Date().toLocaleString("pt-BR"),
    };
  }

  private getUploadTimeoutMs(): number {
    const timeoutMs = Number(process.env.AUTO_BACKUP_UPLOAD_TIMEOUT_MS);

    if (!timeoutMs || Number.isNaN(timeoutMs)) {
      return DEFAULT_BACKUP_UPLOAD_TIMEOUT_MS;
    }

    return timeoutMs;
  }
}

export default new AutoBackupService();
