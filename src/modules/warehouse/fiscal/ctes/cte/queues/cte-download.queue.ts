import { Job } from "bullmq";
import archiver from "archiver";
import { PassThrough } from "stream";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import cteXmlService from "../services/cte-xml.service";
import uploaderService from "../../../../../handlers/uploader/services/uploader.service";
import socketService from "../../../../../handlers/socket/services/socket.service";
import { JobTracker } from "./../helpers/cte-download.tracker";

const BATCH_SIZE = 100;

export interface CteXmlBatchJobData {
  jobId: string;
  userId: string | number;
  ids: string[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Constrói o zip inteiramente em memória (buffer) e retorna pronto pra upload.
// Pra 5000 CTEs de XML isso tende a ficar na casa de poucos MB — tranquilo em memória.
// Se um dia o limite subir bastante, trocar por upload em stream (se a API da nuvem suportar).
function buildZipBuffer(
  ids: string[],
  onProgress: (processed: number) => void,
): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const passthrough = new PassThrough();
    const chunks: Buffer[] = [];

    passthrough.on("data", (c) => chunks.push(c));
    passthrough.on("end", () => resolve(Buffer.concat(chunks)));
    passthrough.on("error", reject);
    archive.on("error", reject);

    archive.pipe(passthrough);

    try {
      let processed = 0;
      const batches = chunk(ids, BATCH_SIZE);

      for (const batch of batches) {
        for await (const { filename, xml } of cteXmlService.streamXmlEntries(
          batch,
        )) {
          archive.append(xml, { name: filename });
        }
        processed += batch.length;
        onProgress(processed);
      }

      await archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}

export class CteXmlBatchQueue extends BaseQueueService<CteXmlBatchJobData> {
  constructor(options: { workless?: boolean } = {}) {
    super("CTE_XML_BATCH", {
      concurrency: 2,
      lockDuration: 30 * 60 * 1000,
      maxProcessingMs: 30 * 60 * 1000,
      workless: options.workless,
    });
  }

  async process(job: Job<CteXmlBatchJobData, void, string>): Promise<void> {
    const { jobId, userId, ids } = job.data;

    try {
      await JobTracker.update(jobId, { status: "processing" });

      const buffer = await buildZipBuffer(ids, async (processed) => {
        await JobTracker.update(jobId, { processed });
        socketService.emitToUser(userId, "cte-xml-batch:progress", {
          jobId,
          processed,
          total: ids.length,
        });
      });

      const cloudPath = await uploaderService.upload({
        buffer,
        filename: `xmls-${jobId}.zip`,
        mimeType: "application/zip",
        directory: "/tmp-exports/cte-xml",
        preserveFilename: true,
        timeoutMs: 60_000,
      });

      await JobTracker.update(jobId, { status: "done", filePath: cloudPath });

      socketService.emitToUser(userId, "job:completed", {
        jobId,
        resultado: { path: cloudPath },
      });

      console.log(`[CteXmlBatchQueue] job=${jobId} concluído -> ${cloudPath}`);
    } catch (err: any) {
      console.error(`[CteXmlBatchQueue] job=${jobId} falhou:`, err);
      await JobTracker.update(jobId, { status: "error", error: err.message });
      socketService.emitToUser(userId, "job:failed", {
        jobId,
        error: err.message,
      });
      throw err; // deixa o BullMQ registrar como failed
    }
  }
}

export default new CteXmlBatchQueue();
