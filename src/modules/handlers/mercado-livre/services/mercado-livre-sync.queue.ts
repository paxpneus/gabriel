import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLExcelRow } from "./mercado-livre.types";
import ordersService from "../../../sales/orders/orders.service";
import { nextRemoveOnQueue, nextStepDelayedOnQueue } from "../../../../shared/types/queue/base-queue";
import Customer from "../../../sales/customers/customers.model";
import { AxiosInstance } from "axios";
import { FullOrder } from "../../../sales/orders/orders.types";

export type MLOrderSyncJobData = { row: MLExcelRow };

export class MLOrderSyncQueue extends BaseQueueService<MLOrderSyncJobData> {
    private blingApi: AxiosInstance;
    private next: nextStepDelayedOnQueue | nextRemoveOnQueue;

    constructor(next: nextStepDelayedOnQueue | nextRemoveOnQueue, blingApi: AxiosInstance) {
        super("ML-ORDER-SYNC", {
            concurrency: 3,
            limiter: { max: 5, duration: 2000 },
        });
        this.blingApi = blingApi;
        this.next = next;
    }

    async process(job: Job<MLOrderSyncJobData>): Promise<void> {
        await this.syncOrder(job.data.row);
    }

    private findClosestOrder(orders: FullOrder[], saleDate: Date): FullOrder | null {
        if (orders.length === 0) return null;
        return orders.reduce((closest, current) => {
            const targetTime = saleDate.getTime();
            const currentDiff = Math.abs(new Date(current.createdAt!).getTime() - targetTime);
            const closestDiff = Math.abs(new Date(closest.createdAt!).getTime() - targetTime);
            return currentDiff < closestDiff ? current : closest;
        });
    }

    private async syncOrder(row: MLExcelRow): Promise<void> {
        const documentSelector = row.business === "Sim" ? { type: "J" } : { document: row.cpf };

        const orders = await ordersService.getFullOrdersByQuery({
            where: { date: row.sale_date, totalPrice: row.revenue_brl },
            include: [{
                model: Customer,
                as: "customer",
                where: { name: row.buyer, ...documentSelector },
            }],
        });

        if (!orders || orders.length === 0) {
            console.log(`[MLOrderSyncQueue] Pedido ${row.order_number} não encontrado. Próximo ciclo.`);
            return;
        }

        let matchedOrder: FullOrder | null = null;

        if (orders.length === 1) {
            matchedOrder = orders[0];
        } else {
            console.warn(`[MLOrderSyncQueue] Pedido ${row.order_number} — ${orders.length} encontrados. Match por horário.`);
            matchedOrder = this.findClosestOrder(orders, new Date(row.sale_date));
        }

        if (!matchedOrder) return;

        await this.processOrder(matchedOrder, row);
    }

    private async processOrder(order: FullOrder, row: MLExcelRow): Promise<void> {
        if (!order.id_order_system) {
            console.warn(`[MLOrderSyncQueue] Pedido ${order.number_order_channel} sem id_order_system.`);
            return;
        }

        let blingOrderData: any;
        try {
            const { data } = await this.blingApi.get(`/pedidos/vendas/${order.id_order_system}`);
            blingOrderData = data.data;
        } catch (error: any) {
            const isServerError = error.response?.status >= 500
            console.error(`[MLOrderSyncQueue] Erro Bling ${order.id_order_system}:`, error.response?.data ?? error.message);
            if (isServerError) {
                throw error;
            }
            return;
        }

        const blingItemCodes: string[] = blingOrderData.itens.map((item: any) => item.codigo);
        const skuMatch = blingItemCodes.some((code) => code === row.sku);

        if (!skuMatch) {
            console.warn(`[MLOrderSyncQueue] Pedido ${order.number_order_channel} — SKU "${row.sku}" não encontrado [${blingItemCodes.join(", ")}].`);
            return;
        }

        const newDate = new Date(row.collection_date);
        const existingDate = order.collection_date ? new Date(order.collection_date) : null;
        if (existingDate && existingDate.getTime() === newDate.getTime()) return;

        await ordersService.update(order.id, { collection_date: newDate, number_order_channel: row.order_number });
        console.log(`[MLOrderSyncQueue] Pedido ${order.number_order_channel} — collection_date: ${newDate.toISOString()}`);

        console.log(`Atualizando campo observação interna do pedido BLING: ${order.number_order_system} <-> ML: ${row.order_number}`)
         // // Atualiza a observação
        // const updateBlingOrderNumber =  await this.blingApi.put(`/pedidos/vendas/${order.id}`, {
        //     observacoesInternas: `${blingOrderData.observacoesInternas ?? ''}\ Referência do pedido no Mercado Livre:  ${row.order_number}`
        // })

        const jobId = `nfe-generation-${order.id_order_system}`;
        await (this.next as nextRemoveOnQueue).removeJob(jobId);

        const oneDayBefore = new Date(newDate);
        oneDayBefore.setDate(oneDayBefore.getDate() - 1);
        const delay = Math.max(0, oneDayBefore.getTime() - Date.now());

        await (this.next as nextStepDelayedOnQueue).addDelayed(
            { order_id: order.id_order_system, collection_date: String(newDate) },
            jobId,
            delay
        );
    }
}