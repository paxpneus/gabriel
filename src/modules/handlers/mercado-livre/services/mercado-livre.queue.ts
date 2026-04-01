import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { nextStepOnQueue } from "../../../../shared/types/queue/base-queue";

export type MLOrderDispatchJobData = {
  order: any;
  customer: any;
};

/**
 * MLOrderQueue — dispatcher puro.
 * Recebe o pedido vindo do CNPJQueue e repassa para o MLOrderSyncQueue.
 * Marca o pedido como WAITING CHANNEL VALIDATION no banco antes de enfileirar,
 * sinalizando que está aguardando match com a base do Mercado Livre.
 */
export class MLOrderQueue extends BaseQueueService<MLOrderDispatchJobData> {
  private next: nextStepOnQueue;

  constructor(next: nextStepOnQueue) {
    super("ML_ORDER_FETCH");
    this.next = next;
  }

  async process(job: Job<MLOrderDispatchJobData>): Promise<void> {
    const { order, customer } = job.data;

    console.log(`[MLOrderQueue] Despachando pedido ${order.numeroLoja} para sync`);

    // Repassa direto para o MLOrderSyncQueue — toda a lógica de match fica lá
    await this.next.add({ order, customer }, `ml-sync-webhook-${order.id}`);
  }
}