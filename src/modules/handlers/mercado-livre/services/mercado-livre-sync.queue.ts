import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLExcelRow } from "./mercado-livre.types";
import ordersService from "../../../sales/orders/orders.service";
import {
  nextRemoveOnQueue,
  nextStepDelayedOnQueue,
} from "../../../../shared/types/queue/base-queue";
import Customer from "../../../sales/customers/customers.model";
import { AxiosInstance } from "axios";
import { FullOrder } from "../../../sales/orders/orders.types";
import sequelize from "../../../../config/sequelize";
import { Op } from "sequelize";

/**
 * Job pode vir de duas origens:
 * 1. MLScrapingQueue — traz { row } com dados completos do Excel
 * 2. MLOrderQueue (webhook) — traz { order, customer } com dados do Bling/webhook
 */
export type MLOrderSyncJobData =
  | { row: MLExcelRow; order?: never; customer?: never }
  | { order: any; customer: any; row?: never };

export class MLOrderSyncQueue extends BaseQueueService<MLOrderSyncJobData> {
  private blingApi: AxiosInstance;
  private next: nextStepDelayedOnQueue & nextRemoveOnQueue;

  constructor(
    next: nextStepDelayedOnQueue & nextRemoveOnQueue,
    blingApi: AxiosInstance,
  ) {
    super("ML-ORDER-SYNC", {
      concurrency: 3,
      limiter: { max: 5, duration: 2000 },
    });
    this.blingApi = blingApi;
    this.next = next;
  }

  async process(job: Job<MLOrderSyncJobData>): Promise<void> {
    if (job.data.order) {
      const dbOrder = await ordersService.findOne({
        where: { number_order_channel: String(job.data.order.numeroLoja) },
      });

      if (dbOrder?.internal_status === "CANCELLED") {
        console.log(
          `[MLOrderSyncQueue] Pedido ${job.data.order.numeroLoja} cancelado — ignorando`,
        );
        return;
      }
    }

    if (job.data.row) {
      // Origem: scraping — tem todos os dados do Excel para fazer o match
      await this.syncFromExcel(job.data.row);
    } else {
      // Origem: webhook — tem order/customer do Bling, sem dados ML ainda
      await this.syncFromWebhook(job.data.order, job.data.customer);
    }
  }

  // ─── Fluxo vindo do scraping ────────────────────────────────────────────

  /**
   * Tenta fazer match do row do Excel com um pedido no banco.
   * Se achar: atualiza collection_date e agenda NFe.
   * Se não achar: loga e segue (pedido pode ainda não ter chegado pelo webhook).
   */
  private async syncFromExcel(row: MLExcelRow): Promise<void> {
    const documentSelector =
      row.business === "Sim" ? { type: "J" } : { document: row.cpf };

    const saleDate = new Date(row.sale_date);

    const orders = await ordersService.getFullOrdersByQuery({
      where: {
        date: {
          [Op.between]: [
            new Date(
              Date.UTC(
                saleDate.getUTCFullYear(),
                saleDate.getUTCMonth(),
                saleDate.getUTCDate(),
                0,
                0,
                0,
                0,
              ),
            ),
            new Date(
              Date.UTC(
                saleDate.getUTCFullYear(),
                saleDate.getUTCMonth(),
                saleDate.getUTCDate(),
                23,
                59,
                59,
                999,
              ),
            ),
          ],
        },
      },
      include: [
        {
          model: Customer,
          as: "customer",
          where: {
            [Op.and]: [
              sequelize.where(
                sequelize.fn("LOWER", sequelize.col("customer.name")),
                "LIKE",
                row.buyer.toLowerCase(),
              ),
              documentSelector,
            ],
          },
        },
      ],
    });

    if (!orders || orders.length === 0) {
      console.log(
        `[MLOrderSyncQueue] Pedido ML ${row.order_number} não encontrado no banco. Aguardando webhook.`,
      );
      return;
    }

    const matchedOrder = this.resolveMatch(
      orders,
      row.sale_date,
      row.order_number,
    );
    if (!matchedOrder) return;

    await this.applyCollectionDate(matchedOrder, row);
  }

  // ─── Fluxo vindo do webhook ─────────────────────────────────────────────

  /**
   * Pedido chegou pelo webhook, tenta encontrar o número do ML no banco
   * (number_order_channel já foi salvo pelo BlingOrderService).
   * Se achar com collection_date já preenchida (scraping rodou antes): agenda NFe direto.
   * Se não tiver collection_date ainda: marca WAITING CHANNEL VALIDATION e aguarda próximo scraping.
   */
  private async syncFromWebhook(order: any, customer: any): Promise<void> {
    const dbOrder = await ordersService.findOne({
      where: { number_order_channel: String(order.numeroLoja) },
    });

    if (!dbOrder) {
      console.warn(
        `[MLOrderSyncQueue] Pedido ${order.numeroLoja} não encontrado no banco via webhook. Ignorando.`,
      );
      return;
    }

    if (dbOrder.collection_date) {
      // Scraping já rodou antes do webhook chegar — agenda NFe direto
      console.log(
        `[MLOrderSyncQueue] Pedido ${order.numeroLoja} já tem collection_date. Agendando NFe direto.`,
      );
      await this.scheduleNfe(dbOrder.id_order_system!, dbOrder.collection_date);
      return;
    }

    // Sem collection_date — marca como aguardando e espera o próximo scraping
    console.log(
      `[MLOrderSyncQueue] Pedido ${order.numeroLoja} sem collection_date. Marcando como WAITING CHANNEL VALIDATION.`,
    );
    await ordersService.update(dbOrder.id, {
      internal_status: "WAITING CHANNEL VALIDATION",
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private resolveMatch(
    orders: FullOrder[],
    saleDate: Date,
    orderNumber: string,
  ): FullOrder | null {
    if (orders.length === 1) return orders[0];

    console.warn(
      `[MLOrderSyncQueue] Pedido ${orderNumber} — ${orders.length} candidatos. Match por horário. ${typeof saleDate}`,
    );
    return orders.reduce((closest, current) => {
      const target = new Date(saleDate).getTime(); // Ponto de atenção: TS nao reclamou de ser string
  
      const currDiff = Math.abs(
        new Date(current.createdAt!).getTime() - target,
      );
      const closeDiff = Math.abs(
        new Date(closest.createdAt!).getTime() - target,
      );
      return currDiff < closeDiff ? current : closest;
    });
  }

  /**
   * Aplica a collection_date no pedido encontrado via scraping,
   * atualiza o number_order_channel com o número ML,
   * muda o status para WAITING FOR NFE EMISSION
   * e agenda o job de NFe no Redis.
   */
  private async applyCollectionDate(
    order: FullOrder,
    row: MLExcelRow,
  ): Promise<void> {
    if (!order.id_order_system) {
      console.warn(
        `[MLOrderSyncQueue] Pedido ${order.number_order_channel} sem id_order_system. Ignorando.`,
      );
      return;
    }

    // Valida SKU na Bling antes de confirmar
    const { valid: skuValid, orderData } = await this.validateSkuOnBling(
      order.id_order_system,
      row.sku,
    );

    if (!skuValid) {
      console.warn(
        `[MLOrderSyncQueue] SKU "${row.sku}" não encontrado no pedido Bling ${order.id_order_system}.`,
      );
      return;
    }

    const newDate = new Date(row.collection_date);
    const existingDate = order.collection_date
      ? new Date(order.collection_date)
      : null;

    // Evita reprocessamento desnecessário
    if (existingDate && existingDate.getTime() === newDate.getTime()) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${order.number_order_channel} já com collection_date correta. Pulando.`,
      );
      return;
    }

    await ordersService.update(order.id, {
      collection_date: newDate,
      number_order_channel: row.order_number,
      internal_status: "WAITING FOR NFE EMISSION",
    });

//     const observacoesAtual = orderData.observacoesInternas ?? ''
// await this.blingApi.put(`/pedidos/vendas/${order.id_order_system}`, {
//   observacoesInternas: `${observacoesAtual}\nNº ML: ${row.order_number}`.trim()
// })


    console.log(
      `[MLOrderSyncQueue] Pedido ${order.number_order_channel} → collection_date: ${newDate.toISOString()}`,
    );

    await this.scheduleNfe(order.id_order_system, newDate);
  }

  /**
   * Remove job anterior (se existir) e cria novo job delayed na NFeQueue,
   * agendado para 1 dia antes da data de coleta.
   */
  private async scheduleNfe(
    idOrderSystem: string,
    collectionDate: Date,
  ): Promise<void> {
    const jobId = `nfe-generation-${idOrderSystem}`;

    // Remove job antigo para evitar duplicatas
    await this.next.removeJob(jobId);

    const oneDayBefore = new Date(collectionDate);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);
    const delay = Math.max(0, oneDayBefore.getTime() - Date.now());

    await this.next.addDelayed(
      { order_id: idOrderSystem, collection_date: String(collectionDate) },
      jobId,
      delay,
    );

    console.log(
      `[MLOrderSyncQueue] NFe agendada para ${oneDayBefore.toISOString()} (pedido ${idOrderSystem})`,
    );
  }

  /**
   * Consulta a Bling para verificar se o SKU do Excel está presente no pedido.
   * Retorna false em erros 4xx (pedido inválido), lança em erros 5xx (retry).
   */
  private async validateSkuOnBling(
    idOrderSystem: string,
    sku: string,
  ): Promise<{ valid: boolean; orderData: any | null }> {
    try {
      const { data } = await this.blingApi.get(
        `/pedidos/vendas/${idOrderSystem}`,
      );
      const codes: string[] = data.data.itens.map((i: any) => i.codigo);
      return {
        valid: codes.some((code) => code === sku),
        orderData: data.data,
      };
    } catch (error: any) {
      if (error.response?.status >= 500 || error.response?.status === 429) throw error;
      console.error(
        `[MLOrderSyncQueue] Erro ao validar SKU no Bling (${idOrderSystem}):`,
        error.response?.data ?? error.message,
      );
      return { valid: false, orderData: null };
    }
  }
}
