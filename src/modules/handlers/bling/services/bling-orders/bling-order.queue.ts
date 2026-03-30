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
        console.log('[1]. Data do job vindo webhook diretamente', job.data)
        console.log(`[1] [QUEUE] Processando Pedido ${job.data.event} - ${job.data.data.id}`)
        const result = await this.orderService.processWebhook(job.data.event, job.data)

        if (result) {
            this.emit('order.ready_for_cnpj', result)
        }
    }
}