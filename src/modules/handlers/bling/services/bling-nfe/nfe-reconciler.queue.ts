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
import Customer from "../../../../sales/customers/customers.model";
import { getBlingIntegration } from "../../api/bling_api.service";
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

// Interface estreita pra checar se uma fila tem job pendente (waiting/
// active/delayed/prioritized), sem esperar/bloquear — usada pro gate no
// topo de process() abaixo.
export type HasPendingJobs = {
  hasPendingJobs: () => Promise<boolean>;
};

export class ReconcilerQueue extends BaseQueueService<NFeReconcilerJobData> {
  private blingApi: AxiosInstance;
  private cnpjNext: nextStepOnQueue | getJob;
  private nfeNext: nextStepDelayedOnQueue | getJob;
  private blingOrderIngestionCheck: HasPendingJobs;
  private cnpjCheck: HasPendingJobs;
  private mlOrderSyncCheck: HasPendingJobs;

  constructor(
    cnpjNext: nextStepOnQueue | getJob,
    nfeNext: nextStepDelayedOnQueue | getJob,
    blingApi: AxiosInstance,
    blingOrderIngestionCheck: HasPendingJobs,
    cnpjCheck: HasPendingJobs,
    mlOrderSyncCheck: HasPendingJobs,
    options: { workless?: boolean } = {},
  ) {
    super("NFE_RECONCILER", {
      concurrency: 1,
      maxProcessingMs: 15 * 60 * 1000,
      workless: options.workless,
    });
    this.blingApi = blingApi;
    this.cnpjNext = cnpjNext;
    this.nfeNext = nfeNext;
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
    ]);

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const names = ["reconcileWaitingNfe", "reconcileOpenOrders", "reconcileStuckOrders"];
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

      // Lock por pedido: corrida estreita com ML_ORDER_SYNC/CollectionDateScheduler
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
    // 10min provou ser curto demais em produção: matching normal (agora via
    // API do marketplace, dentro de ML_ORDER_SYNC) às vezes não termina a
    // tempo, fazendo pedidos normais (ainda em trânsito) caírem aqui como
    // "presos" antes da hora. 30min é o valor usado desde então.
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
            reasonCancelled: OrderReasonCancelled.MARKETPLACE_SYNC_STUCK,
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
                  observacoesInternas: `${liveOrderData.observacoesInternas} \n Pedido marcado como Aguardando verificação humana: Pedido parado em aguardando agendamento de nfe, pelo motivo de não conseguir confirmar dados de coleta/etiqueta junto ao marketplace`,
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
      message: `${stuckOrders.length} pedido(s) em WAITING CHANNEL VALIDATION há mais de 30 min sem confirmação de coleta junto ao marketplace. ${synced} tiveram o internal_status apenas sincronizado (já haviam mudado de situação na Bling).`,
    });
  }
}
