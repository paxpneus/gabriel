import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import ordersService from "../../../sales/orders/order/orders.service";
import { getBlingIntegration } from "../../bling/api/bling_api.service";
import { FullOrder, PendingMarketplaceOrder } from "../../../sales/orders/order/orders.types";
import { getMarketplaceCollectionAndLabelStatus } from "../services/marketplace-order-shipment.service";
import { CollectionDateSchedulerService } from "../../bling/services/bling-nfe/collection-date/collection-date-scheduler.service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";

export type MarketplaceReconcilerTask = "collection_date" | "label_status";

/**
 * Duas cadências num componente só (mesmo padrão de BlingReconcilerQueue —
 * uma classe, job.data.task decide a rotina, duas chamadas de
 * scheduleRepeat com jobId/data diferentes):
 * - collection_date (1h): confirma/reagenda collection_date pra todo
 *   pedido ainda pendente, via CollectionDateSchedulerService.
 * - label_status (5min): só atualiza market_place_label_status — sem
 *   efeito colateral de agendamento, por isso pode rodar bem mais
 *   frequente.
 * Ambas usam a mesma busca genérica (uma consulta order+shipment sempre
 * devolve os dois campos); cada rotina só grava o que lhe compete.
 */
export class MarketplaceReconcilerQueue extends BaseQueueService<Record<string, never>> {
  private collectionDateScheduler: CollectionDateSchedulerService;

  constructor(
    collectionDateScheduler: CollectionDateSchedulerService,
    options: { workless?: boolean } = {},
  ) {
    super("MARKETPLACE_RECONCILER", {
      concurrency: 1,
      maxProcessingMs: 15 * 60 * 1000,
      workless: options.workless,
    });
    this.collectionDateScheduler = collectionDateScheduler;
  }

  async process(job: Job): Promise<void> {
    const task: MarketplaceReconcilerTask = job?.data?.task ?? "collection_date";

    try {
      if (task === "label_status") {
        await this.reconcileLabelStatus();
      } else {
        await this.reconcileCollectionDate();
      }
    } catch (error: any) {
      console.error(`[MarketplaceReconciler] Rotina "${task}" falhou:`, error.message);
      alertService.sendAlert({
        severity: "HIGH",
        title: `MarketplaceReconciler — ${task} falhou`,
        message: `O mecanismo de recuperação automática falhou: ${error.message}`,
      });
    }
  }

  // Compartilhado pelas duas rotinas — chamado uma vez por execução, não
  // duplicado.
  private async getPendingOrders(): Promise<PendingMarketplaceOrder[]> {
    const integration = await getBlingIntegration("Bling");
    const allowedChannels = integration?.allowed_channels ?? [];
    if (!allowedChannels.length) return [];

    return ordersService.findPendingMarketplaceOrders(allowedChannels);
  }

  private async reconcileCollectionDate(): Promise<void> {
    const pendingOrders = await this.getPendingOrders();

    for (const order of pendingOrders) {
      if (!order.id_order_system) continue;

      try {
        await this.withOrderLock(order.id_order_system, async () => {
          const { collectionDate } = await getMarketplaceCollectionAndLabelStatus(
            order.store.name,
            order.number_order_channel,
          );

          if (collectionDate) {
            await this.collectionDateScheduler.syncCollectionDateLocked(
              order.id_order_system!,
              collectionDate,
              order as unknown as FullOrder,
            );
          }
        });
      } catch (error: any) {
        console.error(
          `[MarketplaceReconciler] Erro ao reconciliar collection_date do pedido ${order.id_order_system}:`,
          error.message,
        );
      }
    }
  }

  private async reconcileLabelStatus(): Promise<void> {
    const pendingOrders = await this.getPendingOrders();

    for (const order of pendingOrders) {
      if (!order.id_order_system) continue;

      try {
        await this.withOrderLock(order.id_order_system, async () => {
          const { labelStatus } = await getMarketplaceCollectionAndLabelStatus(
            order.store.name,
            order.number_order_channel,
          );

          await ordersService.update(order.id, { market_place_label_status: labelStatus });
        });
      } catch (error: any) {
        console.error(
          `[MarketplaceReconciler] Erro ao reconciliar label_status do pedido ${order.id_order_system}:`,
          error.message,
        );
      }
    }
  }
}
