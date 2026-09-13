import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import ordersService from "../../../sales/orders/order/orders.service";
import { COMPLETED_ORDER_INTERNAL_STATUSES, FullOrder } from "../../../sales/orders/order/orders.types";
import {
  getMarketplaceCollectionAndLabelStatus,
  getMarketplaceOrdersFromShipment,
} from "../services/marketplace-order-shipment.service";
import { CollectionDateSchedulerService } from "../../bling/services/bling-nfe/collection-date/collection-date-scheduler.service";

export type MarketplaceWebhookTopic = "orders" | "shipments";

export type MarketplaceWebhookSyncJobData = {
  store: string;
  topic: MarketplaceWebhookTopic;
  resourceId: string;
};

/**
 * Reage a webhooks de order/shipment de qualquer marketplace (hoje só
 * Mercado Livre) — nunca confia em dado nenhum do payload do webhook, só o
 * usa pra saber qual recurso re-buscar ao vivo e em qual direção
 * (order→shipment normal, ou shipment→order(s) quando a notificação é
 * sobre um shipment). Uma notificação de shipment pode cobrir mais de um
 * pedido local (agrupamento por pack_id no Mercado Livre) — todo id
 * devolvido por getMarketplaceOrdersFromShipment é sincronizado, não só o
 * primeiro.
 */
export class MarketplaceWebhookSyncQueue extends BaseQueueService<MarketplaceWebhookSyncJobData> {
  private collectionDateScheduler: CollectionDateSchedulerService;

  constructor(
    collectionDateScheduler: CollectionDateSchedulerService,
    options: { workless?: boolean } = {},
  ) {
    super("MARKETPLACE_WEBHOOK_SYNC", {
      concurrency: 10,
      maxProcessingMs: 60_000,
      workless: options.workless,
    });
    this.collectionDateScheduler = collectionDateScheduler;
  }

  async process(job: Job<MarketplaceWebhookSyncJobData>): Promise<void> {
    const { store, topic, resourceId } = job.data;

    const marketplaceOrderIds =
      topic === "orders" ? [resourceId] : await getMarketplaceOrdersFromShipment(store, resourceId);

    for (const marketplaceOrderId of marketplaceOrderIds) {
      await this.syncOneOrder(store, marketplaceOrderId);
    }
  }

  private async syncOneOrder(store: string, marketplaceOrderId: string): Promise<void> {
    const order = await ordersService.findOne({
      where: { number_order_channel: marketplaceOrderId },
    });

    if (!order || !order.id_order_system) return;
    if (COMPLETED_ORDER_INTERNAL_STATUSES.includes(order.internal_status!)) return;

    await this.withOrderLock(order.id_order_system, async () => {
      const { collectionDate, labelStatus } = await getMarketplaceCollectionAndLabelStatus(
        store,
        order.number_order_channel,
      );

      // As DUAS escritas dentro do MESMO withOrderLock. market_place_label_status
      // é gravado mesmo partindo de UNKNOWN — a chegada do webhook já prova
      // que o pedido é de marketplace (única exceção ao gate de
      // inicialização feito em BLING_ORDER_INGESTION).
      await ordersService.update(order.id, { market_place_label_status: labelStatus });

      if (collectionDate) {
        await this.collectionDateScheduler.syncCollectionDateLocked(
          order.id_order_system!,
          collectionDate,
          order as unknown as FullOrder,
        );
      }
    });
  }
}
