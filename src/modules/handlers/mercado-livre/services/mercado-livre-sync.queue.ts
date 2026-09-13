import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import ordersService from "../../../sales/orders/order/orders.service";
import storeService from "../../../sales/stores/stores.service";
import { OrderInternalStatus } from "../../../sales/orders/order/orders.types";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import {
  CollectionDateSchedulerService,
  isEligibleForSync,
} from "../../bling/services/bling-nfe/collection-date/collection-date-scheduler.service";
import { getMarketplaceCollectionAndLabelStatusWithRetry } from "../../marketplace/services/marketplace-order-shipment.service";

/**
 * Job pode vir de duas origens:
 * 1. MLOrderQueue (webhook, via CNPJQueue) — traz { orderSystem, customer }
 *    com dados do Bling/webhook.
 * 2. OrdersController.releaseWaitingAcceptanceForToday — traz
 *    { resumeOrderId } pra retomar o agendamento de um pedido que ficou
 *    preso em waiting_acceptance e acabou de ser liberado (ver
 *    resumeAfterAcceptance).
 */
export type MLOrderSyncJobData =
  | { orderSystem: any; customer: any; resumeOrderId?: never }
  | { resumeOrderId: string; orderSystem?: never; customer?: never };

export class MLOrderSyncQueue extends BaseQueueService<MLOrderSyncJobData> {
  private collectionDateScheduler: CollectionDateSchedulerService;

  constructor(
    collectionDateScheduler: CollectionDateSchedulerService,
    options: { workless?: boolean } = {},
  ) {
    super("ML-ORDER-SYNC", {
      // Pedidos diferentes só serializam via lock por pedido (withOrderLock)
      // — pedidos sem relação nenhuma correm 100% em paralelo entre si.
      concurrency: 10,
      // Precisa cobrir o pior caso do retry de 429 da Bling (5 tentativas,
      // até 60s cada = até 300s) — com 60s aqui, o watchdog abortava o job
      // no meio de um retry ainda válido (Promise.race não cancela a
      // chamada em voo), deixando-a órfã segurando o lock do pedido
      // enquanto uma nova tentativa esbarrava em "Timeout aguardando lock".
      maxProcessingMs: 5 * 60 * 1000,
      workless: options.workless,
    });
    this.collectionDateScheduler = collectionDateScheduler;
  }

  async process(job: Job<MLOrderSyncJobData>): Promise<void> {
    if (job.data.resumeOrderId) {
      await this.resumeAfterAcceptance(job.data.resumeOrderId);
      return;
    }

    if (job.data.orderSystem?.internal_status === OrderInternalStatus.CANCELLED) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${job.data.orderSystem.number_order_channel} cancelado — ignorando`,
      );
      return;
    }

    await this.syncFromWebhook(job.data.orderSystem, job.data.customer);
  }

  // ─── Fluxo vindo do webhook ─────────────────────────────────────────────

  private async syncFromWebhook(orderSystem: any, customer: any): Promise<void> {
    if (!orderSystem) {
      console.warn(
        `[MLOrderSyncQueue] Pedido não encontrado no banco via webhook. Ignorando.`,
      );
      return;
    }

    return this.withOrderLock(orderSystem.id_order_system, () =>
      this.syncFromWebhookLocked(orderSystem, customer),
    );
  }

  /**
   * Consulta a API do marketplace SEMPRE que processa um pedido,
   * independente de ele já ter collection_date ou não (decisão explícita do
   * usuário) — sempre grava market_place_label_status quando a chamada tem
   * sucesso, e usa a collection_date do marketplace quando disponível,
   * caindo pro valor já existente (gravado por BLING_ORDER_INGESTION via
   * dataPrevista) só quando a chamada falha após esgotar o retry.
   */
  private async syncFromWebhookLocked(orderSystem: any, customer: any): Promise<void> {
    const isEligible = await isEligibleForSync(orderSystem.id);
    if (!isEligible) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} não está mais em WAITING CHANNEL VALIDATION (internal_status/situacao.id divergente). Ignorando.`,
      );
      return;
    }

    const storeName = await this.resolveOrderStoreName(orderSystem);
    if (!storeName) {
      console.warn(
        `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} sem store resolvida — não é possível consultar o marketplace.`,
      );
      alertService.sendAlert({
        severity: "LOW",
        title: "ML Sync — pedido sem store",
        message: `Pedido ${orderSystem.id_order_system} não tem store_id resolvido. Requer revisão manual.`,
      });
      return;
    }

    const marketplaceResult = await getMarketplaceCollectionAndLabelStatusWithRetry(
      storeName,
      orderSystem.number_order_channel,
    );

    if (marketplaceResult) {
      // Chamada teve sucesso — sempre grava o status de etiqueta, mesmo que
      // não tenha vindo collection_date ainda.
      await ordersService.update(orderSystem.id, {
        market_place_label_status: marketplaceResult.labelStatus,
      });
    }
    // Se marketplaceResult é null (retry esgotado), market_place_label_status
    // simplesmente não é tocado nesta passada — sem dado novo pra gravar.

    const dateToUse = marketplaceResult?.collectionDate ?? orderSystem.collection_date;

    if (!dateToUse) {
      if (!marketplaceResult) {
        // Todas as tentativas falharam E não há nenhuma collection_date de
        // fallback (nem local — ex: sem dataPrevista da Bling ainda —, nem
        // do marketplace). Deixa o job falhar normalmente: a rede de
        // segurança (MARKETPLACE_WEBHOOK_SYNC / MARKETPLACE_RECONCILER)
        // tenta de novo depois; não há valor de fallback pra usar aqui.
        throw new Error(
          `[MLOrderSyncQueue] Falha ao consultar o marketplace pro pedido ${orderSystem.number_order_channel} e nenhuma collection_date de fallback disponível.`,
        );
      }
      // Chamada teve sucesso mas o shipment ainda não tem data — normal,
      // aguardando o marketplace processar. Permanece em
      // WAITING_CHANNEL_VALIDATION, sem erro.
      return;
    }

    // Se marketplaceResult é null, dateToUse é o valor já existente
    // (gravado pela Bling via dataPrevista) — syncCollectionDateLocked
    // aplica esse fallback mesmo assim, em vez de deixar o pedido parado só
    // porque o marketplace estava fora do ar no momento desta tentativa.
    await this.collectionDateScheduler.syncCollectionDateLocked(
      orderSystem.id_order_system!,
      new Date(dateToUse),
      orderSystem,
    );
  }

  private async resolveOrderStoreName(orderSystem: any): Promise<string | null> {
    if (!orderSystem.store_id) return null;
    const store = await storeService.findById(orderSystem.store_id, {
      attributes: ["name"],
    });
    return store?.name ?? null;
  }

  /**
   * Retoma o agendamento de NFe de um pedido que ficou travado em
   * waiting_acceptance (ver CollectionDateSchedulerService.scheduleNfe,
   * ramo lock_today_orders) e acabou de ser liberado por
   * OrdersController.releaseWaitingAcceptanceForToday.
   *
   * Não reusa isEligibleForSync (exige internal_status ===
   * WAITING_CHANNEL_VALIDATION, que não é mais o caso pra um pedido já
   * travado em WAITING_FOR_NFE_EMISSION) — confirma diretamente o estado
   * esperado pós-liberação: WAITING_FOR_NFE_EMISSION + waiting_acceptance
   * já false.
   */
  async resumeAfterAcceptance(orderId: string): Promise<void> {
    const order = await ordersService.findById(orderId);
    if (!order) {
      console.warn(
        `[MLOrderSyncQueue] resumeAfterAcceptance: pedido ${orderId} não encontrado.`,
      );
      return;
    }

    const idOrderSystem = order.id_order_system;
    if (!idOrderSystem) {
      console.warn(
        `[MLOrderSyncQueue] resumeAfterAcceptance: pedido ${orderId} sem id_order_system.`,
      );
      return;
    }

    return this.withOrderLock(idOrderSystem, () =>
      this.resumeAfterAcceptanceLocked(order, idOrderSystem),
    );
  }

  private async resumeAfterAcceptanceLocked(
    order: any,
    idOrderSystem: string,
  ): Promise<void> {
    if (
      order.internal_status !== OrderInternalStatus.WAITING_FOR_NFE_EMISSION ||
      order.waiting_acceptance
    ) {
      console.log(
        `[MLOrderSyncQueue] resumeAfterAcceptance: pedido ${order.number_order_channel} não está mais no estado esperado (internal_status=${order.internal_status}, waiting_acceptance=${order.waiting_acceptance}). Ignorando.`,
      );
      return;
    }

    if (!order.collection_date) {
      console.warn(
        `[MLOrderSyncQueue] resumeAfterAcceptance: pedido ${order.number_order_channel} sem collection_date. Não é possível agendar NFe.`,
      );
      return;
    }

    await this.collectionDateScheduler.finalizeNfeScheduling(
      idOrderSystem,
      new Date(order.collection_date),
      order,
    );
  }
}
