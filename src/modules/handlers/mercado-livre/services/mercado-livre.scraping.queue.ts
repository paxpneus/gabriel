import { MLScrapingService } from './mercado-livre-scraping.service';
import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLScrapingJobData, MLExcelRow } from './mercado-livre.types';

import ordersService from '../../../sales/orders/orders.service';
import { NFeQueue } from '../../bling/services/bling-nfe/nfe.queue';
import { nextRemoveOnQueue, nextStepDelayedOnQueue } from '../../../../shared/types/queue/base-queue';
import { MLOrderService } from './mercado-livre.service';
import { blingApi } from '../../bling/api/bling_api.service';

export class MLScrapingQueue extends BaseQueueService<MLScrapingJobData> {
    private scrapingService: MLScrapingService;
    private mlOrderService: MLOrderService;
    private next: nextStepDelayedOnQueue | nextRemoveOnQueue;
    

    constructor(scrapingService: MLScrapingService, mlOrderService: MLOrderService, next: nextStepDelayedOnQueue | nextRemoveOnQueue) {
        super('ML-SCRAPING', {concurrency: 1});
        this.scrapingService = scrapingService;
        this.mlOrderService = mlOrderService;
        this.next = next;
    }

    async process(job: Job<MLScrapingJobData, any, string>): Promise<void> {
        console.log(`[MLScrapingQueue] Iniciando sincronização do Excel`);
        const rows = await this.scrapingService.downloadAndParseExcel();
        this.mlOrderService.updateCache(rows);

        console.log(`[MLScrapingQueue] ${rows.length} pedidos encontrados no Excel`);

        for (const row of rows) {
            await this.syncOrder(row)
        }

        console.log(`[MLScrapingQueue] Sincronização concluída`);

    }

    private async syncOrder(row: MLExcelRow): Promise<void> {
        const orderOnBling = blingApi
        const order = await ordersService.findOne({where: {number_order_channel: row.order_number}})

        if (!order) return;

        const newDate = row.collection_date;
        const existingDate = order.collection_date ? new Date(order.collection_date) : null;
        const dateChanged = !existingDate || existingDate.getTime() !== newDate.getTime();

        if (!dateChanged) return;

        await ordersService.update(order.id, {
            collection_date: newDate
        })

        console.log(`[MLScrapingQueue] Pedido ${order.number_order_channel} — collection_date atualizada: ${newDate.toISOString()}`);

        const jobId = `nfe-generation-${order.id_order_system}`;

        await (this.next as nextRemoveOnQueue).removeJob(jobId);

        const oneDayBefore = new Date(newDate)
        oneDayBefore.setDate(oneDayBefore.getDate() - 1)
        const delay = Math.max(0, oneDayBefore.getTime() - Date.now());

        await (this.next as nextStepDelayedOnQueue).addDelayed(
            {order_id: order.id_order_system, collection_date: String(newDate)},
            jobId,
            delay
        )

    }
}