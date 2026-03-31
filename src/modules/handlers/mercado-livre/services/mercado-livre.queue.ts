import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLOrderService } from "./mercado-livre.service";
import { MLOrderJobData } from "./mercado-livre.types";
import { AxiosInstance } from "axios";
import { nextStepDelayedOnQueue, nextStepOnQueue } from "../../../../shared/types/queue/base-queue";
import ordersService from "../../../sales/orders/orders.service";

const MAX_ATTEMPTS = 6; 

const ML_ORDER_ERRORS = {
    ORDER_NOT_FOUND: { id: 3, message: 'Pedido não encontrado no Mercado Livre após tentativas máximas' },
};

export class MLOrderQueue extends BaseQueueService<MLOrderJobData> {
  private mlOrderService: MLOrderService;
  private blingApi: AxiosInstance;
  private next: nextStepOnQueue | nextStepDelayedOnQueue

  constructor(mlOrderService: MLOrderService, blingApi: AxiosInstance, next: nextStepOnQueue | nextStepDelayedOnQueue) {
    super("ML_ORDER_FETCH"); // sem opções extras — segue o padrão da base
    this.mlOrderService = mlOrderService;
    this.blingApi = blingApi;
    this.next = next
  }

  private async markOrderCancelled(order: any, message: string): Promise<void> {
    // await this.blingApi.put(`/pedidos/vendas/${order.id}`, {
    //   observacoesInternas: `${order.observacoesInternas ?? ''}\nPedido Cancelado: ${message}`.trim()
    // })
    // await this.blingApi.patch(`/pedidos/vendas/${order.id}/situacoes/12`)
    console.log(`[MLOrderQueue] Pedido ${order.id} cancelado: ${message}`);
  }

  async process(job: Job<MLOrderJobData>): Promise<void> {
    const { order, customer } = job.data;
    const attempt = job.data.attempt ?? 1;

    console.log(`[MLOrderQueue] Pedido ${order.id} — tentativa ${attempt}/${MAX_ATTEMPTS}`);


    console.log(`[MLOrderQueue] Buscando dados do pedido ${order.id} no ML`);

    const collectionDate = await this.mlOrderService.getCollectionDate(order.numeroLoja)

    if (!collectionDate) {
      if (attempt >= MAX_ATTEMPTS) {
        console.error(`[MLOrderQueue] Pedido ${order.id} — máximo de tentativas atingido`);
        await this.markOrderCancelled(order, ML_ORDER_ERRORS.ORDER_NOT_FOUND.message);
        return;
      }
    

    console.log(`[MLOrderQueue] Data não encontrada, reagendando em 10min...`);



    await (this.next as nextStepOnQueue).add(
            { order, customer, attempt: attempt + 1 },
            `ml-check-${order.id}-attempt-${attempt + 1}`
        );

        return
      }
      // Achou — atualiza collection_date no banco

      await ordersService.update(order.id, {collection_date: collectionDate})
      console.log(`[MLOrderQueue] Pedido ${order.id} — collection_date: ${collectionDate.toISOString()}`);

      const oneDayBefore = new Date(collectionDate);
      oneDayBefore.setDate(oneDayBefore.getDate() - 1);
      const delay = Math.max(0, oneDayBefore.getTime() - Date.now());

      await (this.next as nextStepDelayedOnQueue).addDelayed(
        {order_id: order.id, collection_date: String(collectionDate), },
        `nfe-generation-${order.id}`,
        delay
      )

  }

}