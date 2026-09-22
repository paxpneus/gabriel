import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import {
  nextStepDelayedOnQueue,
  nextRemoveOnQueue,
  getJob,
  nextStepOnQueue,
} from "../../../../../shared/types/queue/base-queue";
import ordersService from "../../../../sales/orders/order/orders.service";
import { Op } from "sequelize";
import { setDelayBasedOnDate } from "../../../../../shared/utils/queues/setDelay";
import { AxiosInstance } from "axios";
import BlingOrderService from "../bling-orders/bling-order.service";
import Customer from "../../../../sales/customers/customers.model";
import { getBlingIntegration } from "../../api/bling_api.service";
import { FullOrder } from "../../../../sales/orders/order/orders.types";
import OrderItems from "../../../../sales/orders/order_items/order_items.model";
import { alertService } from "../../../../../shared/providers/mail-provider/nodemailer.alert";
import { blingGet, blingPut } from "../bling/helpers/get-with-sleep";
import Store from "../../../../sales/stores/stores.model";
import {
  OrderInternalStatus,
  OrderReasonCancelled,
} from "../../../../sales/orders/order/orders.types";
import { escalateToHumanVerificationIfStillPending } from "../../../../sales/orders/order/helpers/order-status";

export type NFeReconcilerJobData = Record<string, never>;

// Interface estreita — só o que reconcileStuckOrders precisa saber sobre a
// ML_ORDER_SYNC pra decidir se pode varrer pedidos presos com segurança.
export type WaitUntilIdle = {
  waitUntilIdle: (maxWaitMs: number) => Promise<boolean>;
};

// Interface estreita pra checar se uma fila tem job pendente (waiting/
// active/delayed/prioritized), sem esperar/bloquear — usada pro gate no
// topo de process() abaixo.
export type HasPendingJobs = {
  hasPendingJobs: () => Promise<boolean>;
};

// Teto de espera por ML-SCRAPING e ML_ORDER_SYNC ficarem livres antes de
// reconcileStuckOrders desistir e pular o sweep desta execução — os dois
// somados cabem dentro do maxProcessingMs de 25min do NFE_RECONCILER (ver
// constructor), deixando folga pro sweep em si e pras outras rotinas que
// rodam em paralelo no mesmo Promise.allSettled.
const ML_SCRAPING_IDLE_WAIT_MS = 10 * 60 * 1000;
const ML_ORDER_SYNC_IDLE_WAIT_MS = 5 * 60 * 1000;

export class ReconcilerQueue extends BaseQueueService<NFeReconcilerJobData> {
  private blingApi: AxiosInstance;
  private cnpjNext: nextStepOnQueue | getJob;
  private nfeNext: nextStepDelayedOnQueue | getJob;
  private mlOrderSyncNext: WaitUntilIdle & nextStepOnQueue;
  private mlScrapingWaitUntilIdle: WaitUntilIdle;
  private blingOrderIngestionCheck: HasPendingJobs;
  private cnpjCheck: HasPendingJobs;
  private mlOrderSyncCheck: HasPendingJobs;

  constructor(
    cnpjNext: nextStepOnQueue | getJob,
    nfeNext: nextStepDelayedOnQueue | getJob,
    blingApi: AxiosInstance,
    mlOrderSyncNext: WaitUntilIdle & nextStepOnQueue,
    mlScrapingWaitUntilIdle: WaitUntilIdle,
    blingOrderIngestionCheck: HasPendingJobs,
    cnpjCheck: HasPendingJobs,
    mlOrderSyncCheck: HasPendingJobs,
    options: { workless?: boolean } = {},
  ) {
    super("NFE_RECONCILER", {
      concurrency: 1,
      maxProcessingMs: 25 * 60 * 1000,
      workless: options.workless,
    });
    this.blingApi = blingApi;
    this.cnpjNext = cnpjNext;
    this.nfeNext = nfeNext;
    this.mlOrderSyncNext = mlOrderSyncNext;
    this.mlScrapingWaitUntilIdle = mlScrapingWaitUntilIdle;
    this.blingOrderIngestionCheck = blingOrderIngestionCheck;
    this.cnpjCheck = cnpjCheck;
    this.mlOrderSyncCheck = mlOrderSyncCheck;
  }

  // Gate no topo de process(): o reconciler só deve rodar (qualquer uma das
  // 4 sub-rotinas) quando as filas "de fluxo normal" do pipeline de pedidos
  // estão vazias — rodar por cima delas some com o Bling rate-limit
  // compartilhado bem no pior momento (backlog grande) e piora exatamente o
  // travamento que o reconciler existe pra destravar. NFE_EMISSION fica de
  // fora de propósito: ela sempre tem job agendado (delay até a hora da
  // coleta), então "vazia" nunca seria um estado real pra ela.
  private async automationQueuesAreClear(): Promise<boolean> {
    const [orderIngestionPending, cnpjPending, mlOrderSyncPending] =
      await Promise.all([
        this.blingOrderIngestionCheck.hasPendingJobs(),
        this.cnpjCheck.hasPendingJobs(),
        this.mlOrderSyncCheck.hasPendingJobs(),
      ]);

    if (orderIngestionPending || cnpjPending || mlOrderSyncPending) {
      const busy = [
        orderIngestionPending && "BLING_ORDER_INGESTION",
        cnpjPending && "CNPJ_VERIFY_CNAE",
        mlOrderSyncPending && "ML_ORDER_SYNC",
      ].filter(Boolean);
      console.log(
        `[NFeReconciler] Pulando execução — ainda há job(s) pendente(s) em ${busy.join(", ")}.`,
      );
      return false;
    }

    return true;
  }

  async process(job: Job<NFeReconcilerJobData>): Promise<void> {
    console.log("[NFeReconciler] Iniciando verificação de jobs perdidos...");

    if (!(await this.automationQueuesAreClear())) return;

    const results = await Promise.allSettled([
      this.reconcileWaitingNfe(),
      this.reconcileOpenOrders(),
      this.reconcileStuckOrders(),
      this.reconcileMissingCollectionDate(),
    ]);

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const names = [
          "reconcileWaitingNfe",
          "reconcileOpenOrders",
          "reconcileStuckOrders",
          "reconcileMissingCollectionDate",
        ];
        console.error(
          `[NFeReconciler] ${names[index]} falhou:`,
          result.reason?.message ?? result.reason,
        );
        alertService.sendAlert({
          severity: "CRITICAL",
          title: `Reconciler — ${names[index]} falhou`,
          message: `O mecanismo de recuperação automática falhou: ${result.reason?.message ?? result.reason}`,
        });
      }
    });
  }

  private async reconcileWaitingNfe(): Promise<void> {
    const integration = await getBlingIntegration("Bling");
    const waiting_acceptance = integration.lock_today_orders
      ? false
      : [true, false];
    const orders = await ordersService.findAll({
      where: {
        internal_status: "WAITING FOR NFE EMISSION",
        nfe_emitted: false,
        collection_date: { [Op.not]: null },
        waiting_acceptance: waiting_acceptance,
      },
    });

    console.log(
      `[GlobalReconciler][NFE] ${orders.length} pedido(s) em WAITING FOR NFE EMISSION.`,
    );

    let recreated = 0;

    for (const order of orders) {
      const idOrderSystem = order.id_order_system;
      if (!idOrderSystem || !order.collection_date) continue;
      const collectionDate = order.collection_date;

      // Lock por pedido: corrida estreita com ML_ORDER_SYNC.scheduleNfe
      // gravando WAITING_FOR_NFE_EMISSION um await antes de agendar o job —
      // sem isso, os dois podiam tentar addDelayed pro mesmo jobId ao mesmo
      // tempo (BullMQ já deduplica por jobId, mas evita a escrita redundante).
      const recreatedJob = await this.withOrderLock(idOrderSystem, async () => {
        const jobId = `nfe-generation-${idOrderSystem}`;
        const existingJob = await (this.nfeNext as getJob).getJob(jobId);

        if (existingJob) return false;

        console.warn(
          `[GlobalReconciler][NFE] Job ${jobId} ausente no Redis. Recriando...`,
        );

        const delay = setDelayBasedOnDate(collectionDate);

        await (this.nfeNext as nextStepDelayedOnQueue).addDelayed(
          {
            order_id: idOrderSystem,
            collection_date: String(collectionDate),
          },
          jobId,
          delay,
        );

        return true;
      });

      if (recreatedJob) recreated++;
    }

    console.log(`[GlobalReconciler][NFE] ${recreated} job(s) recriado(s).`);
  }

  private async reconcileOpenOrders(): Promise<void> {
    const integration = await getBlingIntegration("Bling");
    if (!integration) return;

    const orders = await ordersService.getFullOrdersByQuery({
      where: {
        internal_status: "OPEN",
        nfe_emitted: false,
        collection_date: null,
      },
      include: [
        {
          model: Customer,
          as: "customer",
          attributes: ["id", "name", "type", "document"],
        },
        {
          model: OrderItems,
          as: "items",
          attributes: ["sku"],
        },
        {
        model: Store,
        as: "store",
        where: { name: "MercadoLivre" },
        required: true,
        attributes: ["id", "name"],
      },
      ],
    });

    let recreated = 0;

    for (const order of orders) {
      try {
        const jobId = `document-check-${order.id_order_system}`;
        const existingJob = await (this.cnpjNext as getJob).getJob(jobId);

        if (existingJob) continue;

        await (this.cnpjNext as nextStepOnQueue).add(
          {
            customer: order.customer,
            cnaes: integration.cnaes,
            orderSystem: order,
          },
          jobId,
        );

        recreated++;

        console.log(
          `[GlobalReconciler][OPEN] Pedido ${order.number_order_system} reenfileirado no CNPJQueue.`,
        );
      } catch (error: any) {
        console.error(
          `[GlobalReconciler][OPEN] Erro ao rebuscar pedido ${order.id_order_system} na Bling:`,
          error.response?.data ?? error.message,
        );
      }
    }
  }

  private async reconcileStuckOrders(): Promise<void> {
    // Espera event-driven (sem polling — bloqueia no "drained" do BullMQ),
    // primeiro por ML-SCRAPING ficar livre, depois por ML_ORDER_SYNC ficar
    // livre — nessa ordem, porque o scraping (container worker-scraping,
    // único com Playwright) alimenta o ML_ORDER_SYNC de volta via
    // resumeAfterScrape, não o contrário. Motivo: "situação ainda 748743"
    // pode significar tanto "pedido abandonado de verdade" quanto "ainda
    // não chegou a vez do ML_ORDER_SYNC processar" — pode haver um ciclo de
    // scraping em andamento (inclusive um que o próprio
    // reconcileMissingCollectionDate acabou de disparar, rodando em
    // paralelo no mesmo Promise.allSettled) enquanto o ML_ORDER_SYNC está
    // momentaneamente vazio, só porque o resultado ainda não voltou. Sem
    // esperar o scraping primeiro, este sweep marcaria como "verificação
    // humana" pedidos que um ciclo já em voo estava prestes a resolver.
    const scrapingIsClear = await this.mlScrapingWaitUntilIdle.waitUntilIdle(
      ML_SCRAPING_IDLE_WAIT_MS,
    );
    if (!scrapingIsClear) {
      console.log(
        `[NFeReconciler] ML-SCRAPING ainda ocupado após ${ML_SCRAPING_IDLE_WAIT_MS / 60000}min de espera — pulando sweep de pedidos presos nesta execução (pode haver um ciclo capaz de resolvê-los).`,
      );
      return;
    }

    const mlSyncIsClear = await this.mlOrderSyncNext.waitUntilIdle(
      ML_ORDER_SYNC_IDLE_WAIT_MS,
    );
    if (!mlSyncIsClear) {
      console.log(
        `[NFeReconciler] ML_ORDER_SYNC ainda ocupado após ${ML_ORDER_SYNC_IDLE_WAIT_MS / 60000}min de espera — pulando sweep de pedidos presos nesta execução.`,
      );
      return;
    }

    // 10min provou ser curto demais em produção: o scraping ML tem seu
    // próprio ciclo (start + execução) e às vezes não consegue casar o
    // pedido a tempo, fazendo pedidos normais (ainda em trânsito) caírem
    // aqui como "presos" antes da hora. Voltado pro valor original (30min)
    // até revisarmos com dados reais quanto tempo o matching normal leva.
    const stuckOrders = await ordersService.findAll({
      where: {
        internal_status: "WAITING CHANNEL VALIDATION",
        updatedAt: { [Op.lt]: new Date(Date.now() - 30 * 60 * 1000) },
      },
      include: [
        {
          model: Store,
          as: "store",
          where: { name: "MercadoLivre" },
          required: true,
          attributes: ["id", "name"],
        },
      ],
    });

    if (stuckOrders.length === 0) return;

    let synced = 0;

    for (const order of stuckOrders) {
      const idOrderSystem = order.id_order_system;
      if (!idOrderSystem) continue;

      try {
        // Lock por pedido em volta de toda a sequência (GET+sleeps+PUT+PATCH)
        // — pedidos diferentes do loop seguem em paralelo entre si e com as
        // outras filas do pipeline; só serializa se algo mais tocar esse
        // MESMO pedido ao mesmo tempo.
        await this.withOrderLock(idOrderSystem, async () => {
          const result = await escalateToHumanVerificationIfStillPending({
            idOrderSystem,
            blingApi: this.blingApi,
            allowedPendingStatuses: [OrderInternalStatus.WAITING_CHANNEL_VALIDATION],
            reasonCancelled: OrderReasonCancelled.ML_SCRAPING_NO_MATCH,
            beforeEscalate: async (liveOrderData) => {
              await new Promise((resolve) => setTimeout(resolve, 1000));

              // PUT de /pedidos/vendas é "salvar a venda inteira", não um patch
              // de texto — a Bling revalida a integração de estoque de todos
              // os itens ao salvar, e pode recusar (code 67, saldo
              // insuficiente) por um motivo que não tem nada a ver com a nota
              // que estamos tentando gravar. Isolado num try/catch próprio pra
              // não travar o PATCH de situação, que é o efeito que realmente
              // importa aqui — sem isso, um pedido caía de novo em WAITING
              // CHANNEL VALIDATION sem nunca virar "verificação humana", só
              // reprocessando pra sempre.
              try {
                await blingPut(`/pedidos/vendas/${idOrderSystem}`, {
                  ...liveOrderData,
                  observacoesInternas: `${liveOrderData.observacoesInternas} \n Pedido marcado como Aguardando verificação humana: Pedido parado em aguardando agendamento de nfe, pelo motivo de não conseguir encontrar o pedido na planilha do mercado livre`,
                }, this.blingApi);
              } catch (putError: any) {
                console.error(
                  `[NFeReconciler] Falha ao gravar observação do pedido preso ${idOrderSystem} (seguindo pro PATCH de situação mesmo assim):`,
                  JSON.stringify(putError.response?.data, null, 2),
                );
              }

              await new Promise((resolve) => setTimeout(resolve, 3000));
            },
          });

          if (result.escalated) {
            console.log(
              `[NFeReconciler] Pedido ${idOrderSystem} marcado como verificação humana.`,
            );
          } else {
            console.log(
              `[NFeReconciler] Pedido ${idOrderSystem} não foi marcado como verificação humana (${result.reason}) — status atual na Bling: ${result.internalStatus}. Sincronizado sem editar.`,
            );
            synced++;
          }
        });
      } catch (error: any) {
        console.error(
          `[NFeReconciler] Erro ao processar pedido preso ${idOrderSystem} (GET/PATCH/atualização local):`,
          JSON.stringify(error.response?.data, null, 2),
        );
      }
    }

    alertService.sendAlert({
      severity: "LOW",
      title: "ML Sync — pedidos presos sem coleta",
      message: `${stuckOrders.length} pedido(s) em WAITING CHANNEL VALIDATION há mais de 30 min sem match no scraping. ${synced} tiveram o internal_status apenas sincronizado (já haviam mudado de situação na Bling).`,
    });
  }

  /**
   * Rede de segurança pro scraping da tela de detalhe do ML sob demanda.
   * Pergunta pra Bling (ao vivo, não confia num snapshot local) todos os
   * pedidos ainda em WAITING_CHANNEL_VALIDATION (situação 748743) e separa
   * os que a própria Bling ainda não tem dataPrevista — só pra esses vale a
   * pena extrair da tela do ML, já que os demais já vão resolver via
   * BlingOrderService/ML_ORDER_SYNC no próximo webhook. Só então cruza com
   * o banco: se o pedido local correspondente ainda não tem collection_date
   * (pode já ter sido resolvido nesse meio-tempo), reenfileira um job por
   * pedido na própria ML_ORDER_SYNC (mesmo job shape do webhook,
   * {orderSystem}) — rede de segurança pro caso do disparo original
   * (MLOrderSyncQueue.syncFromWebhookLocked, na chegada do pedido) ter
   * falhado silenciosamente, nunca ter ocorrido, ou a tela do ML ainda não
   * ter nenhuma das duas condições esperadas na 1ª tentativa.
   *
   * Sem withOrderLock aqui: cada pedido vira um job próprio (jobId fixo por
   * pedido, deduplicado pelo BullMQ) — quem serializa contra qualquer outro
   * fluxo tocando o MESMO pedido é o withOrderLock dentro do processamento
   * da ML_ORDER_SYNC, não este loop de disparo.
   */
  private async reconcileMissingCollectionDate(): Promise<void> {
    const integration = await getBlingIntegration("Bling");
    if (!integration) {
      console.warn(
        "[GlobalReconciler][SCRAPING] Integration não encontrada. Pulando.",
      );
      return;
    }

    const dataInicial = new Date();
    dataInicial.setDate(dataInicial.getDate() - 1);
    const dataInicialStr = dataInicial.toISOString().split("T")[0];

    const PAGE_LIMIT = 100;
    let page = 1;
    const missingDataPrevista: any[] = [];

    while (true) {
      const { data } = await blingGet(`/pedidos/vendas`, this.blingApi, {
        params: {
          "idsSituacoes[]": 748743,
          dataInicial: dataInicialStr,
          pagina: page,
          limite: PAGE_LIMIT,
        },
      });

      const blingOrders: any[] = data.data ?? [];
      if (blingOrders.length === 0) break;

      for (const blingOrder of blingOrders) {
        if (!blingOrder.dataPrevista) missingDataPrevista.push(blingOrder);
      }

      if (blingOrders.length < PAGE_LIMIT) break;
      page++;
    }

    if (missingDataPrevista.length === 0) return;

    const numbers = missingDataPrevista.map((o) => String(o.numero));
    const pendingOrders = await ordersService.findAll({
      where: {
        integrations_id: integration.id,
        number_order_system: numbers,
        collection_date: null,
      },
      attributes: [
        "id",
        "id_order_system",
        "number_order_system",
        "number_order_channel",
        "internal_status",
        "collection_date",
        "waiting_acceptance",
        "createdAt",
      ],
    });

    if (pendingOrders.length === 0) return;

    console.log(
      `[GlobalReconciler][SCRAPING] ${pendingOrders.length} pedido(s) em WAITING CHANNEL VALIDATION sem dataPrevista na Bling e sem collection_date local — reenfileirando na ML_ORDER_SYNC.`,
    );

    for (const order of pendingOrders) {
      if (!order.number_order_channel) {
        console.warn(
          `[GlobalReconciler][SCRAPING] Pedido ${order.id} sem number_order_channel — não é possível extrair da tela do ML. Pulando.`,
        );
        continue;
      }

      try {
        await this.mlOrderSyncNext.add(
          { orderSystem: order, customer: null },
          `ml-order-sync-collection-${order.id}`,
        );
      } catch (error: any) {
        console.error(
          `[GlobalReconciler][SCRAPING] Falha ao reenfileirar pedido ${order.id} na ML_ORDER_SYNC:`,
          error.message,
        );
      }
    }
  }
}
