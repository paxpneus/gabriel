import { streamDatabaseDump } from "../../../shared/utils/database/database-dump";
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
    const dump = streamDatabaseDump();

    try {
      const path = await uploaderService.uploadStream({
        stream: dump.stream,
        filename: dump.filename,
        mimeType: dump.mimeType,
        directory: "/backups",
        preserveFilename: true,
        timeoutMs: this.getUploadTimeoutMs(),
      });

      return {
        filename: dump.filename,
        database: dump.database,
        size: dump.getSize(),
        path,
        created_at: new Date().toLocaleString("pt-BR"),
      };
    } finally {
      // no-op se o pg_dump já terminou — evita processo órfão se o upload falhar antes de consumir todo o stream.
      dump.kill();
    }
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
