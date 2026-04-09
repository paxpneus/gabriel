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

export type NFeReconcilerJobData = Record<string, never>; // job sem payload, só disparo periódico

/**
 * NFeReconcilerQueue — orquestrador de resiliência.
 *
 * Roda a cada 5 minutos. Busca todos os pedidos com:
 *   - internal_status = 'WAITING FOR NFE EMISSION' (collection_date definida)
 *   - nfe_emitted = false
 *
 * Para cada um, verifica se o job delayed existe no Redis (NFeQueue).
 * Se não existir (sumiu por restart/crash), recria o job com o delay correto.
 */
export class ReconcilerQueue extends BaseQueueService<NFeReconcilerJobData> {
  private blingApi: AxiosInstance;
  private cnpjNext: nextStepOnQueue | getJob;
  private nfeNext: nextStepDelayedOnQueue | getJob;

  constructor(
    cnpjNext: nextStepOnQueue | getJob,
    nfeNext: nextStepDelayedOnQueue | getJob,
    blingApi: AxiosInstance,
    options: { workless?: boolean } = {}
  ) {
    super("NFE_RECONCILER", { concurrency: 1, workless: options.workless });
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

  // Pedidos que estavam agurdando geração de nota fiscal no dia agendado, mas foram perdidos

  private async reconcileWaitingNfe(): Promise<void> {
    const orders = await ordersService.findAll({
      where: {
        internal_status: "WAITING FOR NFE EMISSION",
        nfe_emitted: false,
        collection_date: { [Op.not]: null },
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

  // Pedidos que chegaram no sistema e pararam seu processo antes de entrar na pipeline

  private async reconcileOpenOrders(): Promise<void> {
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
      ],
    });

    let recreated = 0;

    for (const order of orders) {
      try {
        const integration = await getBlingIntegration("Bling");
        if (!integration) continue;

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
      internal_status: 'WAITING CHANNEL VALIDATION',
      updatedAt: { [Op.lt]: new Date(Date.now() - 4 * 60 * 60 * 1000) }, // 4h
    },
  });

  if (stuckOrders.length > 0) {
    alertService.sendAlert({
      severity: 'MEDIUM',
      title: 'ML Sync — pedidos presos sem coleta',
      message: `${stuckOrders.length} pedido(s) em WAITING CHANNEL VALIDATION há mais de 4h sem match no scraping.`,
    });
  }
}

}
