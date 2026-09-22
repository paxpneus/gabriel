import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLScrapingService } from "./mercado-livre-scraping.service";
import { MLScrapingJobData } from "./mercado-livre.types";
import { nextStepOnQueue } from "../../../../shared/types/queue/base-queue";

/**
 * Extrai a collection_date da tela de detalhe de UM pedido no Mercado Livre
 * (Playwright). Fila separada porque o Worker real (`startScrapingWorker`)
 * só existe no container `worker-scraping` — o único com Chromium instalado
 * (ver Dockerfile, stage `worker-scraping` vs `app`). `ML_ORDER_SYNC` roda
 * no container `worker-automation`, que não tem Playwright, então nunca faz
 * a navegação diretamente — só enfileira aqui e recebe o resultado de volta
 * como um job `{scrapedOrderId, scrapeResult}` na própria `ML_ORDER_SYNC`.
 */
export class MLScrapingQueue extends BaseQueueService<MLScrapingJobData> {
  private scrapingService: MLScrapingService;
  private next: nextStepOnQueue;

  constructor(
    scrapingService: MLScrapingService,
    next: nextStepOnQueue,
    options: { workless?: boolean } = {},
  ) {
    super("ML-SCRAPING", {
      // 1 por vez: MLScrapingService só sustenta uma navegação Playwright
      // por instância (guarda `isRunning`) — concurrency:1 aqui faz o
      // BullMQ enfileirar corretamente em vez de um segundo job concorrente
      // simplesmente receber `null` de volta por cair no guard.
      concurrency: 1,
      lockDuration: 5 * 60 * 1000,
      maxProcessingMs: 5 * 60 * 1000,
      workless: options.workless,
    });
    this.scrapingService = scrapingService;
    this.next = next;
  }

  async process(job: Job<MLScrapingJobData>): Promise<void> {
    const { orderId, numberOrderChannel } = job.data;

    let result = null;
    try {
      result = await this.scrapingService.scrapeOrderDetail(numberOrderChannel);
    } catch (error: any) {
      console.error(
        `[MLScrapingQueue] Falha ao extrair a tela de detalhe do pedido ML ${numberOrderChannel}:`,
        error.message,
      );
    }

    await this.next.add(
      { scrapedOrderId: orderId, scrapeResult: result },
      `ml-order-sync-scraped-${orderId}`,
    );
  }
}
