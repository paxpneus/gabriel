import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import BlingOrderService from "./bling-order.service";


export class BlingOrderQueue extends BaseQueueService<any> {
    private orderService: BlingOrderService;
    constructor(orderService: BlingOrderService) {
        super('BLING_ORDER_INGESTION')
        this.orderService = orderService
    }

    async process(job: Job<any, any, string>): Promise<void> {
        console.log(job.data)
        console.log(`[QUEUE] Processando Pedido ${job.data.event} - ${job.data.data.id}`)
        await this.orderService.processWebhook(job.data.event, job.data)
    }
}