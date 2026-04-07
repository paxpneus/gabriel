import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLExcelRow } from "./mercado-livre.types";
import ordersService from "../../../sales/orders/order/orders.service";
import {
  nextRemoveOnQueue,
  nextStepDelayedOnQueue,
} from "../../../../shared/types/queue/base-queue";
import Customer from "../../../sales/customers/customers.model";
import { AxiosInstance } from "axios";
import { FullOrder } from "../../../sales/orders/order/orders.types";
import sequelize from "../../../../config/sequelize";
import { Op } from "sequelize";
import OrderItems from "../../../sales/orders/order_items/order_items.model";
import { setDelayBasedOnDate } from "../../../../shared/utils/queues/setDelay";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";

/**
 * Job pode vir de duas origens:
 * 1. MLScrapingQueue — traz { row } com dados completos do Excel
 * 2. MLOrderQueue (webhook) — traz { order, customer } com dados do Bling/webhook
 */
export type MLOrderSyncJobData =
  | { row: MLExcelRow; orderSystem?: never; customer?: never }
  | { orderSystem: any; customer: any; row?: never };

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
    if (job.data.orderSystem) {
      if (job.data.orderSystem?.internal_status === "CANCELLED") {
        console.log(
          `[MLOrderSyncQueue] Pedido ${job.data.orderSystem.number_order_channel} cancelado — ignorando`,
        );
        return;
      }
    }

    if (job.data.row) {
      // Origem: scraping — tem todos os dados do Excel para fazer o match
      await this.syncFromExcel(job.data.row);
    } else {
      // Origem: webhook — tem order/customer do Bling, sem dados ML ainda
      await this.syncFromWebhook(job.data.orderSystem, job.data.customer);
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
        {
          model: OrderItems,
          as: "items",
          attributes: ["sku"],
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
  private async syncFromWebhook(
    orderSystem: any,
    customer: any,
  ): Promise<void> {
    if (!orderSystem) {
      console.warn(
        `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} não encontrado no banco via webhook. Ignorando.`,
      );
      return;
    }

    if (orderSystem.collection_date) {
      // Scraping já rodou antes do webhook chegar — agenda NFe direto
      console.log(
        `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} já tem collection_date. Agendando NFe direto.`,
      );
      await this.scheduleNfe(
        orderSystem.id_order_system!,
        orderSystem.collection_date,
        orderSystem,
      );
      return;
    }

    // Sem collection_date — marca como aguardando e espera o próximo scraping
    console.log(
      `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} sem collection_date. Marcando como WAITING CHANNEL VALIDATION.`,
    );
    await ordersService.update(orderSystem.id, {
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
    const skuValid = order.items.some((item) => item.sku == row.sku);

    if (!skuValid) {
      console.warn(
        `[MLOrderSyncQueue] SKU "${row.sku}" não encontrado no pedido Bling ${order.id_order_system}.`,
      );
      alertService.sendAlert({
        severity: "MEDIUM",
        title: "ML Sync — SKU sem match",
        message: `Pedido Bling ${order.id_order_system} não contém SKU "${row.sku}" vindo do ML. Requer revisão manual.`,
      });
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
    orderSystem?: any,
  ): Promise<void> {
    const jobId = `nfe-generation-${idOrderSystem}`;

    await this.next.removeJob(jobId);

    const delay = setDelayBasedOnDate(new Date(collectionDate));

    await this.next.addDelayed(
      {
        order_id: idOrderSystem,
        collection_date: String(collectionDate),
        orderSystem,
      },
      jobId,
      delay,
    );
  }
}