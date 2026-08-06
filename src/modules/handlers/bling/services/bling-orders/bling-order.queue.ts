import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import BlingOrderService from "./bling-order.service";
import { nextStepOnQueue } from "../../../../../shared/types/queue/base-queue";
import { getBlingIntegration } from "../../api/bling_api.service";
import integrationOrderStatusMappingService from "../../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";
import { BLING_SHARED_QUEUE_LOCK } from "../bling/queues/bling-queue-lock";

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
      concurrency: 1,
      limiter: {
        max: 2,
        duration: 1000,
      },
      maxProcessingMs: 120_000,
      sharedLock: BLING_SHARED_QUEUE_LOCK,
      workless: options.workless,
    });
    this.orderService = orderService;
    this.next = next;
  }

  async process(job: Job<any, any, string>): Promise<void> {
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

    // if (result) {
    //   await this.next.add(
    //     result,
    //     `document-check-${result.orderSystem.id_order_system}`,
    //   );
    // }
  }
}
