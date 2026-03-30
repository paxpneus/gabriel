import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLOrderService } from "./mercado-livre.service";
import { MLOrderJobData } from "./mercado-livre.types";
import { AxiosInstance } from "axios";

const ML_ORDER_ERRORS = {
  ORDER_NOT_FOUND: { id: 3, message: "Pedido não encontrado no Mercado Livre" },
};

export class MLOrderQueue extends BaseQueueService<MLOrderJobData> {
  private mlOrderService: MLOrderService;
  private blingApi: AxiosInstance;

  constructor(mlOrderService: MLOrderService, blingApi: AxiosInstance) {
    super("ML_ORDER_FETCH"); // sem opções extras — segue o padrão da base
    this.mlOrderService = mlOrderService;
    this.blingApi = blingApi;
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

    console.log(`[MLOrderQueue] Buscando dados do pedido ${order.id} no ML`);

    let mlData;
    try {
      mlData = await this.mlOrderService.getOrderData(order);
    } catch (error: any) {
      const isNotFound = error?.response?.status === 404;

      if (isNotFound) {
        await this.markOrderCancelled(order, ML_ORDER_ERRORS.ORDER_NOT_FOUND.message);
        return; // não relança — sem retry para 404
      }

      // API fora, timeout etc — relança e o BullMQ faz retry (3x com backoff, herdado da base)
      console.error(`[MLOrderQueue] Falha ao buscar no ML, tentativa ${job.attemptsMade + 1}:`, error.message);
      throw error;
    }

    const oneDayBefore = new Date(mlData.collection_date);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);
    const delay = 60 * 1000;

    console.log(
      `[MLOrderQueue] Coleta: ${mlData.collection_date.toISOString()} | ` +
      `Relatório agendado para: ${oneDayBefore.toISOString()} | ` +
      `Delay: ${(delay / 1000 / 60 / 60).toFixed(1)}h`
    );

    this.emit('ml.fetched', {
      order_id: order.id,
      collection_date: String(mlData.collection_date),
      delay
    })

    // TODO: await this.reportQueue.addDelayed(
    //   { order, customer, ml_order_id: mlData.ml_order_id, collection_date: mlData.collection_date },
    //   `report-${order.id}`,
    //   delay
    // );
  }
}