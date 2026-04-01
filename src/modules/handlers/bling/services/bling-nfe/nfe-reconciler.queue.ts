import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import { nextStepDelayedOnQueue, nextRemoveOnQueue, getJob } from "../../../../../shared/types/queue/base-queue";
import ordersService from "../../../../sales/orders/orders.service";
import { Op } from "sequelize";

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
export class NFeReconcilerQueue extends BaseQueueService<NFeReconcilerJobData> {
  private next: nextStepDelayedOnQueue | nextRemoveOnQueue | getJob;

  constructor(next: nextStepDelayedOnQueue | nextRemoveOnQueue | getJob) {
    super("NFE_RECONCILER", { concurrency: 1 });
    this.next = next;
  }

  async process(job: Job<NFeReconcilerJobData>): Promise<void> {
    console.log("[NFeReconciler] Iniciando verificação de jobs perdidos...");

    // Busca todos os pedidos aguardando emissão de NFe
    const pendingOrders = await ordersService.findAll({
      where: {
        internal_status: "WAITING FOR NFE EMISSION",
        nfe_emitted: false,
        collection_date: { [Op.not]: null },
      },
    });

    if (pendingOrders.length === 0) {
      console.log("[NFeReconciler] Nenhum pedido pendente.");
      return;
    }

    console.log(
      `[NFeReconciler] ${pendingOrders.length} pedidos em WAITING FOR NFE EMISSION.`,
    );

    let recreated = 0;

    for (const order of pendingOrders) {
      if (!order.id_order_system || !order.collection_date) continue;

      const jobId = `nfe-generation-${order.id_order_system}`;
      const existingJob = await (this.next as getJob).getJob(jobId);

      if (existingJob) continue; // job está vivo no Redis, tudo certo

      // Job sumiu — recria com delay calculado a partir da collection_date
      console.warn(
        `[NFeReconciler] Job ${jobId} não encontrado no Redis. Recriando...`,
      );

      const oneDayBefore = new Date(order.collection_date);
      oneDayBefore.setDate(oneDayBefore.getDate() - 1);
      const delay = Math.max(0, oneDayBefore.getTime() - Date.now());

      await (this.next as nextStepDelayedOnQueue).addDelayed(
        {
          order_id: order.id_order_system,
          collection_date: String(order.collection_date),
        },
        jobId,
        delay,
      );

      recreated++;
    }

    console.log(
      `[NFeReconciler] Concluído. ${recreated} job(s) recriado(s).`,
    );
  }
}