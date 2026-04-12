import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLExcelRow } from "./mercado-livre.types";
import ordersService from "../../../sales/orders/order/orders.service";
import {
  nextRemoveOnQueue,
  nextStepDelayedOnQueue,
  getJob,
} from "../../../../shared/types/queue/base-queue";
import Customer from "../../../sales/customers/customers.model";
import { AxiosInstance } from "axios";
import { FullOrder } from "../../../sales/orders/order/orders.types";
import sequelize from "../../../../config/sequelize";
import { Model, Op } from "sequelize";
import OrderItems from "../../../sales/orders/order_items/order_items.model";
import { setDelayBasedOnDate } from "../../../../shared/utils/queues/setDelay";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import redisService from "../../../../shared/utils/base-models/base-redis";
import integrationsService from "../../../integrations/integrations/integrations.service";

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
  private next: nextStepDelayedOnQueue & nextRemoveOnQueue & getJob;

  constructor(
    next: nextStepDelayedOnQueue & nextRemoveOnQueue & getJob,
    blingApi: AxiosInstance,
    options: { workless?: boolean } = {},
  ) {
    super("ML-ORDER-SYNC", {
      concurrency: 1,
      limiter: { max: 1, duration: 3000 },
      workless: options.workless,
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
      const cachedOrders = await redisService.get<FullOrder[]>(
        `orders_seven_days_ago`,
      );

      if (!cachedOrders) {
        console.error("[MISS CACHE] Cache não encontrado na MLOrderSyncQueue");
        return;
      }

      console.log("[HIT CACHE] ---------");

      // Origem: scraping — tem todos os dados do Excel para fazer o match
      await this.syncFromExcel(job.data.row, cachedOrders);
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
  private async syncFromExcel(
    row: MLExcelRow,
    ordersSystem: FullOrder[],
  ): Promise<void> {
    const saleDate = new Date(row.sale_date);

    const filtered = ordersSystem.filter((order) => {
      if (!order.date) return false;
      const orderDate = new Date(order.date);
      const sameDay =
        orderDate.getUTCFullYear() === saleDate.getUTCFullYear() &&
        orderDate.getUTCMonth() === saleDate.getUTCMonth() &&
        orderDate.getUTCDate() === saleDate.getUTCDate();

      const nameMatch = order.customer?.name
        ?.toLowerCase()
        .includes(row.buyer.toLowerCase());

      return sameDay && nameMatch;
    });

    if (!filtered.length) {
      console.log(
        `[MLOrderSyncQueue] Pedido ML ${row.order_number} não encontrado. Aguardando webhook.`,
      );
      return;
    }

    const matchedOrder = this.resolveMatch(
      filtered,
      row.sale_date,
      row.order_number,
    );
    if (!matchedOrder) return;

    await this.applyCollectionDate(matchedOrder, row);

    // ── Irmãos: mesmo cliente, mesmo SKU, createdAt próximo ──────────────
    const siblings = this.findSiblingOrders(
      matchedOrder,
      row.sku,
      ordersSystem,
    );

    if (siblings.length) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${row.order_number} — ${siblings.length} irmão(s) encontrado(s). Aplicando mesma collection_date.`,
      );
      for (const sibling of siblings) {
        await this.applyCollectionDate(sibling, row, true);
      }
    }
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

    //TESTE
    // if (!orderSystem.collection_date) {
    //   const {data} = await this.blingApi.get(`/pedidos/vendas/${orderSystem.id_order_system}`)
    //   const orderUpdated = ordersService.update(orderSystem.id, {
    //     collection_date: new Date(data.data.dataPrevista)
    //   })

    //   //@ts-ignore
    //   await this.scheduleNfe(
    //     //@ts-ignore
    //     orderUpdated.id_order_system!,
    //     //@ts-ignore
    //     orderUpdated.collection_date,
    //     orderUpdated,
    //   );
    //   return;
    // }

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
    isSibling: boolean = false,
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
    });

    const { data } = await this.blingApi.get(
      `/pedidos/vendas/${order.id_order_system}`,
    );
    if (isSibling) {
      await this.blingApi.put(`/pedidos/vendas/${order.id_order_system}`, {
        ...data.data,
        observacoesInternas:
          `${data.data.observacoesInternas} \n Atenção: Há mais de um pedido com estas mesmas informações, número do pedido do Mercado Livre pode estar errado, favor verificar no Mercado Livre. ML: ${row.order_number}`.trim(),
      });
    } else {
      await this.blingApi.put(`/pedidos/vendas/${order.id_order_system}`, {
        ...data.data,
        observacoesInternas:
          `${data.data.observacoesInternas} \n ML: ${row.order_number}`.trim(),
      });
    }

    console.log(
      `[MLOrderSyncQueue] Pedido ${order.number_order_channel} → collection_date: ${newDate.toISOString()}`,
    );

    await this.scheduleNfe(order.id_order_system, newDate, order);
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

    const integration = await integrationsService.getFullIntegration({
      where: {name: 'Bling'}
    })

    if (orderSystem.internal_status == 'EMITTED') {
       console.log(
      `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} já em status final (${orderSystem.internal_status}). Ignorando.`,
    );
    return;
    }

    const collectionIsToday = this.isToday(new Date(collectionDate));
    const createdToday = orderSystem.createdAt
      ? this.isToday(new Date(orderSystem.createdAt))
      : false;

    if (collectionIsToday && createdToday) {
      // Cenário 1: chegou hoje, ainda sem job → trava para aceite manual
      const alreadyScheduled = await this.next.getJob(jobId);

      if (integration.lock_today_orders) {
      if (!alreadyScheduled) {
        console.log(
          `[MLOrderSyncQueue] Coleta HOJE e sem job agendado — travando pedido ${idOrderSystem} (waiting_acceptance)`,
        );

        await ordersService.update(orderSystem.id, {
          internal_status: "WAITING FOR NFE EMISSION",
          waiting_acceptance: true,
        });
        return;
      }

      if (orderSystem?.waiting_acceptance) {
        console.log(
          `[MLOrderSyncQueue] Coleta HOJE mas waiting_acceptance ainda true — aguardando liberação manual para pedido ${idOrderSystem}`,
        );
        return;
      }
      }

      console.log(
        `[MLOrderSyncQueue] Coleta HOJE e waiting_acceptance liberado — emitindo NFe para pedido ${idOrderSystem}`,
      );
    }

    await this.next.removeJob(jobId);

    const isTomorrow = this.isNextDay(collectionDate);

    const MIN_DELAY_MS = 30_000;

    const delay = isTomorrow
      ? MIN_DELAY_MS
      : Math.max(setDelayBasedOnDate(new Date(collectionDate)), MIN_DELAY_MS);

    if (isTomorrow) {
      console.log(
        `[MLOrderSyncQueue] Coleta amanhã — NFe agendada imediatamente para pedido ${idOrderSystem}`,
      );
    }

    await this.blingApi.patch(
      `/pedidos/vendas/${idOrderSystem}/situacoes/748748`,
      {
        id: 748748,
      },
    );

    await ordersService.update(orderSystem.id, {
      internal_status: "WAITING FOR NFE EMISSION",
    });

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

  private isNextDay(date: Date): boolean {
    const tomorrow = new Date();
    const tomorrowUTC = Date.UTC(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth(),
      tomorrow.getUTCDate() + 1,
    );
    const dateUTC = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
    return dateUTC === tomorrowUTC;
  }

  private readonly SIBLING_WINDOW_MS = 10 * 60 * 1_000;

  private findSiblingOrders(
    matched: FullOrder,
    sku: string,
    allOrders: FullOrder[],
  ): FullOrder[] {
    const matchedTime = new Date(matched.createdAt!).getTime();
    const matchedName = matched.customer?.name?.toLowerCase() ?? "";

    return allOrders.filter((order) => {
      if (order.id === matched.id) return false;

      const sameName = order.customer?.name?.toLowerCase() === matchedName;
      const hasSku = order.items.some((item) => item.sku === sku);
      const timeDiff = Math.abs(
        new Date(order.createdAt!).getTime() - matchedTime,
      );

      return sameName && hasSku && timeDiff <= this.SIBLING_WINDOW_MS;
    });
  }

  private isToday(date: Date): boolean {
    const now = new Date();
    return (
      date.getUTCFullYear() === now.getUTCFullYear() &&
      date.getUTCMonth() === now.getUTCMonth() &&
      date.getUTCDate() === now.getUTCDate()
    );
  }
}
