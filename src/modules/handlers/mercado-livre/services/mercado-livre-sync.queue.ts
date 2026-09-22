import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLScrapingService } from "./mercado-livre-scraping.service";
import ordersService from "../../../sales/orders/order/orders.service";
import {
  nextRemoveOnQueue,
  nextStepDelayedOnQueue,
  getJob,
} from "../../../../shared/types/queue/base-queue";
import { AxiosInstance } from "axios";
import {
  COMPLETED_ORDER_INTERNAL_STATUSES,
  OrderInternalStatus,
} from "../../../sales/orders/order/orders.types";
import { setDelayBasedOnDate } from "../../../../shared/utils/queues/setDelay";
import integrationsService from "../../../integrations/integrations/integrations.service";
import {
  blingGet,
  blingPut,
  blingPatch,
} from "../../bling/services/bling/helpers/get-with-sleep";
import { mapOrderInternalStatus } from "../../../../shared/utils/normalizers/bling/status-mapper";

/**
 * Job pode vir de duas origens:
 * 1. MLOrderQueue (webhook) — traz { orderSystem, customer } com dados do Bling/webhook
 * 2. OrdersController.releaseWaitingAcceptanceForToday — traz { resumeOrderId }
 *    pra retomar o agendamento de um pedido que ficou preso em
 *    waiting_acceptance e acabou de ser liberado (ver resumeAfterAcceptance)
 */
export type MLOrderSyncJobData =
  | { orderSystem: any; customer: any; resumeOrderId?: never }
  | { resumeOrderId: string; orderSystem?: never; customer?: never };

export class MLOrderSyncQueue extends BaseQueueService<MLOrderSyncJobData> {
  private blingApi: AxiosInstance;
  private next: nextStepDelayedOnQueue & nextRemoveOnQueue & getJob;
  private scrapingService: MLScrapingService;

  constructor(
    next: nextStepDelayedOnQueue & nextRemoveOnQueue & getJob,
    blingApi: AxiosInstance,
    scrapingService: MLScrapingService,
    options: { workless?: boolean } = {},
  ) {
    super("ML-ORDER-SYNC", {
      // Pedidos diferentes só serializam via lock por pedido (withOrderLock)
      // agora — antes um mutex global + limiter de 1 job/3s travava a fila
      // inteira atrás de qualquer backlog, deixando pedidos novos presos
      // atrás de pedidos antigos sem relação nenhuma.
      concurrency: 10,
      // Precisa cobrir o pior caso do retry de 429 da Bling (5 tentativas,
      // até 60s cada = até 300s) e o próprio scraping da tela de detalhe
      // (Playwright: login + navegação) — com um teto curto aqui, o
      // watchdog abortava o job no meio de uma chamada ainda válida
      // (Promise.race não cancela a chamada em voo), deixando-a órfã
      // segurando o lock do pedido enquanto uma nova tentativa esbarrava em
      // "Timeout aguardando lock".
      maxProcessingMs: 5 * 60 * 1000,
      workless: options.workless,
    });
    this.blingApi = blingApi;
    this.next = next;
    this.scrapingService = scrapingService;
  }

  async process(job: Job<MLOrderSyncJobData>): Promise<void> {
    if (job.data.resumeOrderId) {
      await this.resumeAfterAcceptance(job.data.resumeOrderId);
      return;
    }

    if (job.data.orderSystem?.internal_status === "CANCELLED") {
      console.log(
        `[MLOrderSyncQueue] Pedido ${job.data.orderSystem.number_order_channel} cancelado — ignorando`,
      );
      return;
    }

    await this.syncFromWebhook(job.data.orderSystem, job.data.customer);
  }

  // ─── Guarda: só segue se o pedido ainda estiver de fato aguardando validação de canal ──

  /**
   * Rebusca o pedido só com internal_status e actual_situation para confirmar
   * que ele ainda está em WAITING CHANNEL VALIDATION (748743 na Bling).
   * Evita processar pedido que já mudou de situação entre o enqueue e o processamento.
   *
   * Usa `actual_situation` (não `source_payload.situacao.id`): CNPJQueue
   * avança o pedido pra 748743 direto na Bling (applyWaitingNfeStatus) e só
   * grava `internal_status` localmente — não reescreve `source_payload`, que
   * só é atualizado por um webhook completo (create/updateOrderFromBling).
   * Checar `source_payload` aqui fazia essa checagem falhar sempre logo
   * depois do avanço pelo CNPJQueue, já que o snapshot ainda tinha a
   * situação antiga ("Em Aberto"), mesmo com `internal_status` já correto —
   * derrubando o agendamento de NFe de todo pedido que passa por ali.
   */
  private async isEligibleForSync(orderId: string): Promise<boolean> {
    const orderData = await ordersService.findById(orderId, {
      attributes: ["internal_status", "actual_situation"],
    });

    if (!orderData) return false;

    return (
      orderData.internal_status === "WAITING CHANNEL VALIDATION" &&
      String((orderData as any).actual_situation) === "748743"
    );
  }

  // ─── Fluxo vindo do webhook ─────────────────────────────────────────────

  /**
   * Pedido chegou pelo webhook, tenta encontrar o número do ML no banco
   * (number_order_channel já foi salvo pelo BlingOrderService).
   * Se achar com collection_date já preenchida (dataPrevista da Bling): agenda NFe direto.
   * Se não tiver collection_date ainda: extrai da tela de detalhe do Mercado Livre.
   */
  private async syncFromWebhook(
    orderSystem: any,
    customer: any,
  ): Promise<void> {
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

  // scheduleNfe é chamado daqui já dentro do lock do pedido acima.
  private async syncFromWebhookLocked(
    orderSystem: any,
    customer: any,
  ): Promise<void> {
    const isEligible = await this.isEligibleForSync(orderSystem.id);
    if (!isEligible) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} não está mais em WAITING CHANNEL VALIDATION (internal_status/situacao.id divergente). Ignorando.`,
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

    // Sem collection_date — extrai direto da tela de detalhe do pedido no
    // Mercado Livre (por number_order_channel), no mesmo job, sem passar
    // por outra fila.
    console.log(
      `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} sem collection_date. Marcando como WAITING CHANNEL VALIDATION e extraindo da tela de detalhe do ML.`,
    );
    await ordersService.update(orderSystem.id, {
      internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
    });
    await this.scrapeAndApplyCollectionDate(orderSystem);
  }

  /**
   * Abre a tela de detalhe do pedido no Mercado Livre (via
   * number_order_channel) e, se conseguir extrair a collection_date,
   * aplica no pedido e segue para o agendamento da NFe. Se a tela não tiver
   * nenhuma das três condições esperadas (NF-e já emitida / coleta de
   * amanhã / coleta do dia X), o pedido fica em WAITING CHANNEL VALIDATION
   * para uma nova tentativa
   * (ver ReconcilerQueue.reconcileMissingCollectionDate).
   */
  async scrapeAndApplyCollectionDate(orderSystem: any): Promise<void> {
    if (!orderSystem.number_order_channel) {
      console.warn(
        `[MLOrderSyncQueue] Pedido ${orderSystem.id} sem number_order_channel — não é possível localizar a tela do Mercado Livre.`,
      );
      return;
    }

    let result: Awaited<
      ReturnType<MLScrapingService["scrapeOrderDetail"]>
    >;
    try {
      result = await this.scrapingService.scrapeOrderDetail(
        orderSystem.number_order_channel,
      );
    } catch (error: any) {
      console.error(
        `[MLOrderSyncQueue] Falha ao extrair a tela de detalhe do pedido ML ${orderSystem.number_order_channel}:`,
        error.message,
      );
      return;
    }

    if (!result) {
      console.log(
        `[MLOrderSyncQueue] Pedido ML ${orderSystem.number_order_channel} — nenhuma condição de collection_date encontrada na tela ainda. Aguardando próxima tentativa.`,
      );
      return;
    }

    await this.applyCollectionDate(orderSystem, result.collection_date);
  }

  /**
   * Aplica a collection_date extraída da tela de detalhe do ML no pedido,
   * muda o status para WAITING FOR NFE EMISSION e agenda o job de NFe.
   * Assume que já está dentro do withOrderLock do pedido (chamado só por
   * scrapeAndApplyCollectionDate, que por sua vez só roda dentro de
   * syncFromWebhookLocked) — não pega o lock de novo.
   */
  private async applyCollectionDate(
    order: any,
    collectionDate: Date,
  ): Promise<void> {
    if (!order.id_order_system) {
      console.warn(
        `[MLOrderSyncQueue] Pedido ${order.number_order_channel} sem id_order_system. Ignorando.`,
      );
      return;
    }

    if (COMPLETED_ORDER_INTERNAL_STATUSES.includes(order.internal_status)) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${order.number_order_channel} já com processo completo (${order.internal_status}) — ignorando scraping.`,
      );
      return;
    }

    const isEligible = await this.isEligibleForSync(order.id);
    if (!isEligible) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${order.number_order_channel} não está mais em WAITING CHANNEL VALIDATION (internal_status/situacao.id divergente). Ignorando.`,
      );
      return;
    }

    const newDate = new Date(collectionDate);
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
    });

    const { data } = await blingGet(
      `/pedidos/vendas/${order.id_order_system}`,
      this.blingApi,
    );
    await blingPut(
      `/pedidos/vendas/${order.id_order_system}`,
      {
        ...data.data,
        observacoesInternas:
          `${data.data.observacoesInternas} \n ML: ${order.number_order_channel}`.trim(),
      },
      this.blingApi,
    );

    console.log(
      `[MLOrderSyncQueue] Pedido ${order.number_order_channel} → collection_date: ${newDate.toISOString()}`,
    );

    await this.scheduleNfe(order.id_order_system, newDate, order);
  }

  /**
   * Remove job anterior (se existir) e cria novo job delayed na NFeQueue,
   * agendado para o mesmo dia da data de coleta, às 06:00. Se já passou das
   * 13:00 no dia da coleta, agenda para o dia seguinte às 06:00.
   *
   * Assume que já está rodando dentro do withOrderLock do pedido (chamado
   * só por applyCollectionDate/syncFromWebhookLocked) — não pega o
   * lock de novo aqui.
   */
  private async scheduleNfe(
    idOrderSystem: string,
    collectionDate: Date,
    orderSystem?: any,
  ): Promise<void> {
    const jobId = `nfe-generation-${idOrderSystem}`;

    const integration = await integrationsService.getFullIntegration({
      where: { name: "Bling" },
    });

    if (
      COMPLETED_ORDER_INTERNAL_STATUSES.includes(orderSystem.internal_status)
    ) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} já com processo completo (${orderSystem.internal_status}). Ignorando.`,
      );
      return;
    }

    const isEligible = await this.isEligibleForSync(orderSystem.id);
    if (!isEligible) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} não está mais em WAITING CHANNEL VALIDATION (internal_status/situacao.id divergente) — não agenda NFe.`,
      );
      return;
    }

    const now = new Date();

    const startOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    ).getTime();

    const createdAt = new Date(orderSystem.createdAt).getTime();
    const collectionMs = new Date(collectionDate).getTime();

    const createdToday = createdAt >= startOfDay;

    const collectionIsTodayOrFuture = collectionMs >= startOfDay;

    if (createdToday && collectionIsTodayOrFuture) {
      // Cenário 1: chegou hoje, ainda sem job → trava para aceite manual.
      // `collectionIsTodayOrFuture` inclui qualquer coleta futura, não só
      // hoje — os logs abaixo não podem dizer "coleta HOJE" nem "emitindo",
      // já que quem decide a data/hora real do disparo é
      // setDelayBasedOnDate (via finalizeNfeScheduling logo abaixo), e a
      // emissão em si só acontece muito depois, quando o job delayed
      // dispara na NFeQueue — aqui só agenda.
      const alreadyScheduled = await this.next.getJob(jobId);

      if (integration.lock_today_orders) {
        if (!alreadyScheduled) {
          console.log(
            `[MLOrderSyncQueue] Pedido ${idOrderSystem} chegou hoje e ainda sem job agendado — travando (waiting_acceptance)`,
          );

          await ordersService.update(orderSystem.id, {
            internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
            waiting_acceptance: true,
          });
          return;
        }

        if (orderSystem?.waiting_acceptance) {
          console.log(
            `[MLOrderSyncQueue] Pedido ${idOrderSystem} chegou hoje mas waiting_acceptance ainda true — aguardando liberação manual`,
          );
          return;
        }
      }

      console.log(
        `[MLOrderSyncQueue] Pedido ${idOrderSystem} chegou hoje e waiting_acceptance liberado — seguindo para agendamento da NFe`,
      );
    }

    await this.finalizeNfeScheduling(idOrderSystem, collectionDate, orderSystem);
  }

  /**
   * PATCH da situação Bling pra 748748 + grava WAITING_FOR_NFE_EMISSION +
   * agenda o job delayed na NFeQueue. Chamada só depois que scheduleNfe (ou
   * resumeAfterAcceptance) já validou o pedido pelo snapshot local — não
   * confia só nisso: reconfere a situação ao vivo na Bling antes do PATCH,
   * porque `isEligibleForSync` lê `source_payload` (snapshot do último
   * webhook processado), que pode estar desatualizado — principalmente pra
   * resumeAfterAcceptance, onde pode ter passado bastante tempo entre o
   * pedido ser travado (waiting_acceptance) e alguém liberar manualmente.
   * Assume que já está dentro do withOrderLock do pedido, igual scheduleNfe.
   */
  private async finalizeNfeScheduling(
    idOrderSystem: string,
    collectionDate: Date,
    orderSystem: any,
  ): Promise<void> {
    const { data } = await blingGet(
      `/pedidos/vendas/${idOrderSystem}`,
      this.blingApi,
    );
    const currentSituacaoId = data?.data?.situacao?.id;
    const mappedStatus = mapOrderInternalStatus(currentSituacaoId);

    if (mappedStatus !== OrderInternalStatus.WAITING_CHANNEL_VALIDATION) {
      console.log(
        `[MLOrderSyncQueue] Pedido ${orderSystem.number_order_channel} não está mais em WAITING CHANNEL VALIDATION na Bling (situação atual ${currentSituacaoId} -> ${mappedStatus}) — sincronizando sem agendar NFe.`,
      );
      await ordersService.update(orderSystem.id, {
        internal_status: mappedStatus,
        ...(COMPLETED_ORDER_INTERNAL_STATUSES.includes(mappedStatus)
          ? { nfe_emitted: true }
          : mappedStatus === OrderInternalStatus.CANCELLED
            ? { nfe_emitted: false }
            : {}),
      });
      return;
    }

    const jobId = `nfe-generation-${idOrderSystem}`;

    await this.next.removeJob(jobId);

    const MIN_DELAY_MS = 30_000;

    const delay = Math.max(
      setDelayBasedOnDate(new Date(collectionDate)),
      MIN_DELAY_MS,
    );

    await blingPatch(
      `/pedidos/vendas/${idOrderSystem}/situacoes/748748`,
      {
        id: 748748,
      },
      this.blingApi,
    );

    await ordersService.update(orderSystem.id, {
      internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
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

  /**
   * Retoma o agendamento de NFe de um pedido que ficou travado em
   * waiting_acceptance (ver scheduleNfe, ramo lock_today_orders) e acabou de
   * ser liberado por OrdersController.releaseWaitingAcceptanceForToday.
   *
   * Não reusa isEligibleForSync (exige internal_status ===
   * WAITING_CHANNEL_VALIDATION, que não é mais o caso pra um pedido já
   * travado em WAITING_FOR_NFE_EMISSION) — confirma diretamente o estado
   * esperado pós-liberação: WAITING_FOR_NFE_EMISSION + waiting_acceptance
   * já false. Sem isso, o pedido ficava só com a flag zerada no banco, sem
   * nunca de fato fazer o PATCH pra 748748 na Bling — a próxima vez que a
   * NFE_EMISSION rodasse pra ele (via reconcileWaitingNfe recriando o job
   * faltando) via situação ainda 748743 e mandava pra verificação humana.
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

    await this.finalizeNfeScheduling(
      idOrderSystem,
      new Date(order.collection_date),
      order,
    );
  }
}
