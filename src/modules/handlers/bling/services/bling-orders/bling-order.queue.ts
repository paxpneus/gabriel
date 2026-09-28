import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import BlingOrderService from "./bling-order.service";
import { nextStepOnQueue } from "../../../../../shared/types/queue/base-queue";
import { getBlingIntegration } from "../../api/bling_api.service";
import integrationOrderStatusMappingService from "../../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";

// Webhook de pedido pode chegar antes de a nota fiscal ficar visível em
// GET /pedidos/vendas/{id} na Bling (notaFiscal.id ainda vazio) — delay dá
// tempo da Bling propagar o vínculo antes do fetch, em vez de gravar
// invoice_id nulo e nunca mais tentar de novo.
export const ORDER_WEBHOOK_INGESTION_DELAY_MS = 30_000;

// BullMQ: menor número = maior prioridade. 1 é o topo já usado por outras
// filas (ver bling-webhook.orchestrator.ts) — pedido de atualização manual
// via front-end nunca deve esperar atrás do backlog normal de webhook.
export const FORCE_UPDATE_PRIORITY = 1;
export const NORMAL_ORDER_PRIORITY = 2;

export class BlingOrderQueue extends BaseQueueService<any> {
  private orderService: BlingOrderService;
  private next: nextStepOnQueue;
  private defaultsEnsured = false;

  constructor(
    orderService: BlingOrderService,
    next: nextStepOnQueue,
    options: { workless?: boolean } = {},
  ) {
    super("BLING_ORDER_INGESTION", {
      // Pedidos diferentes só serializam via lock por pedido (withOrderLock)
      // agora, não mais por mutex global entre filas.
      concurrency: 5,
      limiter: {
        max: 5,
        duration: 1000,
      },
      maxProcessingMs: 120_000,
      workless: options.workless,
    });
    this.orderService = orderService;
    this.next = next;
  }

  override async add(
    data: any,
    jobId?: string,
    jobOptions?: { priority?: number; removeOnComplete?: boolean | { age: number; count?: number } },
  ) {
    return super.add(data, jobId, {
      ...jobOptions,
      priority: jobOptions?.priority ?? NORMAL_ORDER_PRIORITY,
    });
  }

  override async addDelayed(data: any, jobId: string, delayMs: number) {
    return super.addDelayed(data, jobId, delayMs, {
      priority: NORMAL_ORDER_PRIORITY,
    });
  }

  async process(job: Job<any, any, string>): Promise<void> {
    // Trava pelo id do pedido na Bling (é o que vira id_order_system uma vez
    // persistido) — mesma chave que as demais filas do pipeline usam, então
    // um evento de webhook duplicado/rápido pro mesmo pedido serializa
    // corretamente contra CNPJ/ML_SYNC/NFE_EMISSION tocando esse pedido.
    return this.withOrderLock(job.data.data.id, () => this.processOrder(job));
  }

  private async processOrder(job: Job<any, any, string>): Promise<void> {
    console.log("[1]. Data do job vindo webhook diretamente", job.data);
    console.log(
      `[1] [QUEUE] Processando Pedido ${job.data.event} - ${job.data.data.id}`,
    );
    const integration = await getBlingIntegration("Bling");
    if (integration && !this.defaultsEnsured) {
      await integrationOrderStatusMappingService.ensureBlingDefaults(
        integration.id,
      );
      this.defaultsEnsured = true;
    }

    const result = await this.orderService.processWebhook(
      job.data.event,
      job.data,
    );

    if (result) {
      await this.next.add(
        result,
        `document-check-${result.orderSystem.id_order_system}`,
      );
    }
  }
}
