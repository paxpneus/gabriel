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
import { blingGet, blingPut, blingPatch } from "../bling/helpers/get-with-sleep";
import Store from "../../../../sales/stores/stores.model";
import { mapOrderInternalStatus } from "../../../../../shared/utils/normalizers/bling/status-mapper";
import {
  COMPLETED_ORDER_INTERNAL_STATUSES,
  OrderInternalStatus,
  OrderReasonCancelled,
} from "../../../../sales/orders/order/orders.types";

export type NFeReconcilerJobData = Record<string, never>;

// Interface estreita — só o que reconcileStuckOrders precisa saber sobre a
// ML_ORDER_SYNC pra decidir se pode varrer pedidos presos com segurança.
export type WaitUntilIdle = {
  waitUntilIdle: (maxWaitMs: number) => Promise<boolean>;
};

// Teto de espera por ML-SCRAPING e ML_ORDER_SYNC ficarem livres antes de
// reconcileStuckOrders desistir e pular o sweep desta execução — os dois
// somados (15min) cabem dentro do maxProcessingMs de 25min do
// NFE_RECONCILER (ver constructor), deixando ~10min de folga pro sweep em
// si e pras outras rotinas que rodam em paralelo no mesmo Promise.allSettled.
const ML_SCRAPING_IDLE_WAIT_MS = 10 * 60 * 1000;
const ML_ORDER_SYNC_IDLE_WAIT_MS = 5 * 60 * 1000;

export class ReconcilerQueue extends BaseQueueService<NFeReconcilerJobData> {
  private blingApi: AxiosInstance;
  private cnpjNext: nextStepOnQueue | getJob;
  private nfeNext: nextStepDelayedOnQueue | getJob;
  private mlOrderSyncNext: WaitUntilIdle;
  private mlScrapingNext: nextStepOnQueue;
  private mlScrapingWaitUntilIdle: WaitUntilIdle;

  constructor(
    cnpjNext: nextStepOnQueue | getJob,
    nfeNext: nextStepDelayedOnQueue | getJob,
    blingApi: AxiosInstance,
    mlOrderSyncNext: WaitUntilIdle,
    mlScrapingNext: nextStepOnQueue,
    mlScrapingWaitUntilIdle: WaitUntilIdle,
    options: { workless?: boolean } = {},
  ) {
    super("NFE_RECONCILER", {
      concurrency: 1,
      // Subiu de 15 pra 25min junto com ML_SCRAPING_IDLE_WAIT_MS (10min) —
      // reconcileStuckOrders sozinha já pode esperar até 15min (10 de
      // scraping + 5 de ML_ORDER_SYNC) antes mesmo de começar o sweep.
      maxProcessingMs: 25 * 60 * 1000,
      workless: options.workless,
    });
    this.blingApi = blingApi;
    this.cnpjNext = cnpjNext;
    this.nfeNext = nfeNext;
    this.mlOrderSyncNext = mlOrderSyncNext;
    this.mlScrapingNext = mlScrapingNext;
    this.mlScrapingWaitUntilIdle = mlScrapingWaitUntilIdle;
  }

  async process(job: Job<NFeReconcilerJobData>): Promise<void> {
    console.log("[NFeReconciler] Iniciando verificação de jobs perdidos...");

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
    // livre — nessa ordem, porque scraping alimenta ML_ORDER_SYNC, não o
    // contrário. Motivo: "situação ainda 748743" pode significar tanto
    // "pedido abandonado de verdade" quanto "ainda não chegou a vez do
    // ML_ORDER_SYNC processar" — e, agora que o scraping roda sob demanda
    // (não tem mais cron fixo), pode até haver um ciclo de scraping em
    // andamento (inclusive disparado por reconcileMissingCollectionDate,
    // rodando em paralelo neste mesmo Promise.allSettled) que ainda nem
    // terminou de distribuir os jobs {row} pro ML_ORDER_SYNC — nesse
    // instante o ML_ORDER_SYNC está vazio, mas não porque o pedido foi
    // abandonado. Sem esperar o scraping primeiro, este sweep marcaria como
    // "verificação humana" pedidos que um ciclo já em voo estava prestes a
    // resolver corretamente.
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
          const { data } = await blingGet(
            `/pedidos/vendas/${idOrderSystem}`,
            this.blingApi,
          );

          const currentSituacaoId = data?.data?.situacao?.id;
          const mappedStatus = mapOrderInternalStatus(currentSituacaoId);

          // Pedido já mudou de situação na Bling por fora do reconciler
          if (mappedStatus !== "WAITING CHANNEL VALIDATION") {
            console.log(
              `[NFeReconciler] Pedido ${idOrderSystem} já mudou de situação na Bling (situacao ${currentSituacaoId} -> ${mappedStatus}). Sincronizando sem editar.`,
            );
            await ordersService.update(order.id, {
              internal_status: mappedStatus,
              ...(COMPLETED_ORDER_INTERNAL_STATUSES.includes(mappedStatus)
                ? { nfe_emitted: true }
                : mappedStatus === OrderInternalStatus.CANCELLED
                  ? { nfe_emitted: false }
                  : {}),
            });
            synced++;
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));

          // PUT de /pedidos/vendas é "salvar a venda inteira", não um patch de
          // texto — a Bling revalida a integração de estoque de todos os itens
          // ao salvar, e pode recusar (code 67, saldo insuficiente) por um
          // motivo que não tem nada a ver com a nota que estamos tentando
          // gravar. Isolado num try/catch próprio pra não travar o PATCH de
          // situação abaixo, que é o efeito que realmente importa aqui — sem
          // isso, um pedido caía de novo em WAITING CHANNEL VALIDATION sem
          // nunca virar "verificação humana", só reprocessando pra sempre.
          try {
            await blingPut(`/pedidos/vendas/${idOrderSystem}`, {
              ...data.data,
              observacoesInternas: `${data.data.observacoesInternas} \n Pedido marcado como Aguardando verificação humana: Pedido parado em aguardando agendamento de nfe, pelo motivo de não conseguir encontrar o pedido na planilha do mercado livre`,
            }, this.blingApi);
          } catch (putError: any) {
            console.error(
              `[NFeReconciler] Falha ao gravar observação do pedido preso ${idOrderSystem} (seguindo pro PATCH de situação mesmo assim):`,
              JSON.stringify(putError.response?.data, null, 2),
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 3000));

          await blingPatch(
            `/pedidos/vendas/${idOrderSystem}/situacoes/748772`,
            { id: 748772 },
            this.blingApi,
          );

          await ordersService.update(order.id, {
            internal_status: mapOrderInternalStatus(748772),
            nfe_emitted: false,
            reason_cancelled: OrderReasonCancelled.ML_SCRAPING_NO_MATCH,
          });

          console.log(
            `[NFeReconciler] Pedido ${idOrderSystem} marcado como verificação humana.`,
          );
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
   * Rede de segurança pro scraping sob demanda. Pergunta pra Bling (ao
   * vivo, não confia num snapshot local) todos os pedidos ainda em
   * WAITING_CHANNEL_VALIDATION (situação 748743) e separa os que a própria
   * Bling ainda não tem dataPrevista — só pra esses vale a pena rodar
   * scraping, já que os demais já vão resolver via
   * BlingOrderService/ML_ORDER_SYNC no próximo webhook sem precisar de
   * planilha nenhuma. Só então cruza com o banco: se o pedido local
   * correspondente ainda não tem collection_date (pode já ter sido
   * resolvido nesse meio-tempo por um scraping anterior), dispara um ciclo
   * de scraping — rede de segurança pro caso do disparo original
   * (MLOrderSyncQueue.syncFromWebhookLocked, na chegada do pedido) ter
   * falhado silenciosamente ou nunca ter ocorrido.
   *
   * Sem withOrderLock: não faz leitura-decisão-escrita sobre nenhum pedido
   * específico — só decide "existe algum pendente?" e dispara um .add()
   * compartilhado e idempotente (mesmo jobId fixo usado por
   * MLOrderSyncQueue.triggerScraping), então não há corrida sobre o MESMO
   * pedido que precise de lock aqui.
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
      attributes: ["id", "id_order_system", "number_order_system"],
    });

    if (pendingOrders.length === 0) return;

    console.log(
      `[GlobalReconciler][SCRAPING] ${pendingOrders.length} pedido(s) em WAITING CHANNEL VALIDATION sem dataPrevista na Bling e sem collection_date local — disparando scraping sob demanda.`,
    );

    try {
      await this.mlScrapingNext.add(
        { triggered_by: "nfe-reconciler" },
        "ml-scraping-on-demand",
      );
    } catch (error: any) {
      console.error(
        "[GlobalReconciler][SCRAPING] Falha ao disparar scraping sob demanda:",
        error.message,
      );
    }
  }
}
