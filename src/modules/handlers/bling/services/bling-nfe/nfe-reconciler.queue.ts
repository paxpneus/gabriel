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
import { BLING_SHARED_QUEUE_LOCK } from "../bling/queues/bling-queue-lock";
import Store from "../../../../sales/stores/stores.model";
import { mapOrderInternalStatus } from "../../../../../shared/utils/normalizers/bling/status-mapper";
import {
  COMPLETED_ORDER_INTERNAL_STATUSES,
  OrderInternalStatus,
} from "../../../../sales/orders/order/orders.types";

export type NFeReconcilerJobData = Record<string, never>;

export class ReconcilerQueue extends BaseQueueService<NFeReconcilerJobData> {
  private blingApi: AxiosInstance;
  private cnpjNext: nextStepOnQueue | getJob;
  private nfeNext: nextStepDelayedOnQueue | getJob;

  constructor(
    cnpjNext: nextStepOnQueue | getJob,
    nfeNext: nextStepDelayedOnQueue | getJob,
    blingApi: AxiosInstance,
    options: { workless?: boolean } = {},
  ) {
    super("NFE_RECONCILER", {
      concurrency: 1,
      sharedLock: BLING_SHARED_QUEUE_LOCK,
      maxProcessingMs: 15 * 60 * 1000,
      workless: options.workless,
    });
    this.blingApi = blingApi;
    this.cnpjNext = cnpjNext;
    this.nfeNext = nfeNext;
  }

  async process(job: Job<NFeReconcilerJobData>): Promise<void> {
    console.log("[NFeReconciler] Iniciando verificação de jobs perdidos...");

    const results = await Promise.allSettled([
      this.reconcileWaitingNfe(),
      this.reconcileOpenOrders(),
      this.reconcileStuckOrders(),
    ]);

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const names = [
          "reconcileWaitingNfe",
          "reconcileOpenOrders",
          "reconcileStuckOrders",
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
      if (!order.id_order_system || !order.collection_date) continue;

      const jobId = `nfe-generation-${order.id_order_system}`;
      const existingJob = await (this.nfeNext as getJob).getJob(jobId);

      if (existingJob) continue;

      console.warn(
        `[GlobalReconciler][NFE] Job ${jobId} ausente no Redis. Recriando...`,
      );

      const delay = setDelayBasedOnDate(order.collection_date);

      await (this.nfeNext as nextStepDelayedOnQueue).addDelayed(
        {
          order_id: order.id_order_system,
          collection_date: String(order.collection_date),
        },
        jobId,
        delay,
      );

      recreated++;
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
    const stuckOrders = await ordersService.findAll({
      where: {
        internal_status: "WAITING CHANNEL VALIDATION",
        updatedAt: { [Op.lt]: new Date(Date.now() - 0.5 * 60 * 60 * 1000) },
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
      try {
        const { data } = await this.blingApi.get(
          `/pedidos/vendas/${order.id_order_system}`,
        );

        const currentSituacaoId = data?.data?.situacao?.id;
        const mappedStatus = mapOrderInternalStatus(currentSituacaoId);

        // Pedido já mudou de situação na Bling por fora do reconciler
        if (mappedStatus !== "WAITING CHANNEL VALIDATION") {
          console.log(
            `[NFeReconciler] Pedido ${order.id_order_system} já mudou de situação na Bling (situacao ${currentSituacaoId} -> ${mappedStatus}). Sincronizando sem editar.`,
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
          continue;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        await this.blingApi.put(`/pedidos/vendas/${order.id_order_system}`, {
          ...data.data,
          observacoesInternas: `${data.data.observacoesInternas} \n Pedido marcado como Aguardando verificação humana: Pedido parado em aguardando agendamento de nfe, pelo motivo de não conseguir encontrar o pedido na planilha do mercado livre`,
        });

        await new Promise((resolve) => setTimeout(resolve, 3000));

        await this.blingApi.patch(
          `/pedidos/vendas/${order.id_order_system}/situacoes/748772`,
          { id: 748772 },
        );

        await ordersService.update(order.id, {
          internal_status: mapOrderInternalStatus(748772),
          nfe_emitted: false,
        });

        console.log(
          `[NFeReconciler] Pedido ${order.id_order_system} marcado como verificação humana.`,
        );
      } catch (error: any) {
        console.error(
          `[NFeReconciler] Erro ao processar pedido preso ${order.id_order_system}:`,
          JSON.stringify(error.response?.data, null, 2),
        );
      }
    }

    alertService.sendAlert({
      severity: "MEDIUM",
      title: "ML Sync — pedidos presos sem coleta",
      message: `${stuckOrders.length} pedido(s) em WAITING CHANNEL VALIDATION há mais de 2h sem match no scraping. ${synced} tiveram o internal_status apenas sincronizado (já haviam mudado de situação na Bling).`,
    });
  }
}
