import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import {
  nextStepDelayedOnQueue,
  nextRemoveOnQueue,
  getJob,
  nextStepOnQueue,
} from "../../../../../shared/types/queue/base-queue";
import ordersService from "../../../../sales/orders/orders.service";
import { Op } from "sequelize";
import { setDelayBasedOnDate } from "../../../../../shared/utils/queues/setDelay";
import { AxiosInstance } from "axios";
import BlingOrderService from "../bling-orders/bling-order.service";
import Customer from "../../../../sales/customers/customers.model";
import { getBlingIntegration } from "../../api/bling_api.service";
import { FullOrder } from "../../../../sales/orders/orders.types";

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
  private blingOrderService: BlingOrderService;
  private cnpjNext: nextStepOnQueue | getJob;
  private nfeNext: nextStepDelayedOnQueue | getJob;

  constructor(
    cnpjNext: nextStepOnQueue | getJob,
    nfeNext: nextStepDelayedOnQueue | getJob,
    blingApi: AxiosInstance,
    blingOrderService: BlingOrderService,
  ) {
    super("NFE_RECONCILER", { concurrency: 1 });
    this.blingApi = blingApi;
    this.blingOrderService = blingOrderService;
    this.cnpjNext = cnpjNext;
    this.nfeNext = nfeNext;
  }

  async process(job: Job<NFeReconcilerJobData>): Promise<void> {
    console.log("[NFeReconciler] Iniciando verificação de jobs perdidos...");

    const results = await Promise.allSettled([
      this.reconcileWaitingNfe(),
      this.reconcileOpenOrders(),
      this.reconcileBlingOrders(),
    ]);

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const names = [
          "reconcileWaitingNfe",
          "reconcileOpenOrders",
          "reconcileBlingOrders",
        ];
        console.error(
          `[NFeReconciler] ${names[index]} falhou:`,
          result.reason?.message ?? result.reason,
        );
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
      ],
    });

    let recreated = 0;

    for (const order of orders) {
      try {
        const { data } = await this.blingApi.get(
          `/pedidos/vendas/${order.id_order_system}`,
        );
        const orderData = data.data;

        const integration = await getBlingIntegration("Bling");
        if (!integration) continue;

        const jobId = `document-check-${order.customer_id}`;
        const existingJob = await (this.cnpjNext as getJob).getJob(jobId);

        if (existingJob) continue;

        await (this.cnpjNext as nextStepOnQueue).add(
          {
            customer: order.customer,
            cnaes: integration.cnaes,
            order: orderData,
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

  private async reconcileBlingOrders(): Promise<void> {
    const integration = await getBlingIntegration("Bling");

    if (!integration) {
      console.warn(
        "[GlobalReconciler][BLING] Integration não encontrada. Pulando.",
      );
      return;
    }

    const channelResponse = await this.blingApi.get(`/canais-venda`, {
      params: { tipos: ["MercadoLivre"], situacao: 1 },
    });

    const STORE_ID: number | undefined = channelResponse.data.data?.[0]?.id;

    console.log("[DEBUG][BLING] STORE_ID:", STORE_ID);

    if (!STORE_ID) {
      console.warn(
        "[GlobalReconciler][BLING] Canal MercadoLivre não encontrado.",
      );
      return;
    }

    const STATUS_EM_ABERTO = 6;
    const PAGE_LIMIT = 100;

    let page = 1;
    let totalFound = 0;
    let created = 0;

    try {
      while (true) {
        const { data } = await this.blingApi.get(`/pedidos/vendas`, {
          params: {
            idLoja: STORE_ID,
            "idsSituacoes[]": STATUS_EM_ABERTO,
            pagina: page,
            limite: PAGE_LIMIT,
          },
        });
        console.log("[DEBUG][BLING] Pedidos retornados:", data.data?.length);

        const orders: any[] = data.data ?? [];
        if (orders.length === 0) break;
        totalFound += orders.length;

        for (const blingOrder of orders) {
          const exists = await ordersService.findOne({
            where: {
              integration_id: integration.id,
              number_order_system: String(blingOrder.numero),
            },
          });

          if (exists) continue;

          console.log(
            `[GlobalReconciler][BLING] Pedido ${blingOrder.numero} não encontrado no banco. Criando...`,
          );

          try {
            await this.blingOrderService.createOrderFromBling({
              data: { id: blingOrder.id },
            });
            created++;
          } catch (err: any) {
            console.error(
              `[GlobalReconciler][BLING] Erro ao criar pedido ${blingOrder.numero}:`,
              err.response?.data ?? err.message,
            );
          }
        }

        // Bling retorna menos que o limite → última página
        if (orders.length < PAGE_LIMIT) break;
        page++;
      }
    } catch (err: any) {
      console.error(
        "[GlobalReconciler][BLING] Erro ao consultar pedidos:",
        err.response?.data ?? err.message,
      );
    }
  }
}
