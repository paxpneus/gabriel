import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import BlingOrderService from "./bling-order.service";
import { nextStepOnQueue } from "../../../../../shared/types/queue/base-queue";


export class BlingOrderQueue extends BaseQueueService<any> {
    private orderService: BlingOrderService;
    private next: nextStepOnQueue;
    
    constructor(orderService: BlingOrderService, next: nextStepOnQueue,  options: { workless?: boolean } = {}) {
        super('BLING_ORDER_INGESTION', {
            concurrency: 1,
            limiter: {
                max: 1,
                duration: 3000
            },
            workless: options.workless
        })
        this.orderService = orderService
        this.next = next
    }

    async process(job: Job<any, any, string>): Promise<void> {
        console.log('[1]. Data do job vindo webhook diretamente', job.data)
        console.log(`[1] [QUEUE] Processando Pedido ${job.data.event} - ${job.data.data.id}`)
        const result = await this.orderService.processWebhook(job.data.event, job.data)
        

        if (result) {
            await this.next.add(result, `document-check-${result.orderSystem.id_order_system}`);
        }
    }
}