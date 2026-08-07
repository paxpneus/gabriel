import { Job } from "bullmq";
import {
  BaseQueueService,
  baseQueueOptions,
} from "../../../../../../../shared/utils/base-models/base-queue-service";
import { BlingManifestacaoService } from "./nfe-manifest-web-scraping.service";
import { BLING_SHARED_QUEUE_LOCK } from "../../../bling/queues/bling-queue-lock";

export type BlingNfeScrapingJobData = Record<string, never>;

export class BlingNfeScrapingQueue extends BaseQueueService<BlingNfeScrapingJobData> {
  private manifestacaoService: BlingManifestacaoService;

  constructor(
    manifestacaoService: BlingManifestacaoService,
    options: { workless?: boolean } = {}
  ) {
    super("BLING_NFE_SCRAPING", {
      concurrency: 1,
      lockDuration: 15 * 60 * 1000,
      maxProcessingMs: 5 * 60 * 1000,
      sharedLock: BLING_SHARED_QUEUE_LOCK,
      workless: options?.workless
    });
    this.manifestacaoService = manifestacaoService;
  }

  async process(_job: Job<BlingNfeScrapingJobData>): Promise<void> {
    console.log(
      "[BlingNfeScrapingQueue] Iniciando manifestação de NF-es no Bling...",
    );

    const result =
      await this.manifestacaoService.manifestarNotasComoOperacaoRealizada();

    console.log("[BlingNfeScrapingQueue] Job concluído:", result);
  }
}
