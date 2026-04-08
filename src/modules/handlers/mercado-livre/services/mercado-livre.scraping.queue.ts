import { MLScrapingService } from "./mercado-livre-scraping.service";
import { Job } from "bullmq";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { MLScrapingJobData } from "./mercado-livre.types";

import { nextStepOnQueue } from "../../../../shared/types/queue/base-queue";
import { MLOrderService } from "./mercado-livre.service";
import { AxiosInstance } from "axios";
import { baseQueueOptions } from "../../../../shared/utils/base-models/base-queue-service";
import ordersService from "../../../sales/orders/order/orders.service";
import { Model, Op } from "sequelize";
import Customer from "../../../sales/customers/customers.model";
import OrderItems from "../../../sales/orders/order_items/order_items.model";
import redisService from "../../../../shared/utils/base-models/base-redis";

export class MLScrapingQueue extends BaseQueueService<MLScrapingJobData> {
  private scrapingService: MLScrapingService;
  private mlOrderService: MLOrderService;
  private next: nextStepOnQueue;

  constructor(
    scrapingService: MLScrapingService,
    mlOrderService: MLOrderService,
    next: nextStepOnQueue,
    options?: baseQueueOptions,
  ) {
    super(
      "ML-SCRAPING",
      options ?? { concurrency: 1, lockDuration: 15 * 60 * 1000 },
    );
    this.scrapingService = scrapingService;
    this.mlOrderService = mlOrderService;
    this.next = next;
  }

  async process(job: Job<MLScrapingJobData>): Promise<void> {
    const min = 1 * 60 * 1000;
    const max = 3 * 60 * 1000;
    const sleep = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(
      `[MLScrapingQueue] Próxima execução em ${Math.round(sleep / 60000)} min`,
    );
    await new Promise((resolve) => setTimeout(resolve, sleep));

    console.log(`[MLScrapingQueue] Iniciando sincronização do Excel`);

    const rows = await this.scrapingService.downloadAndParseExcel();
    this.mlOrderService.updateCache(rows);

    console.log(
      `[MLScrapingQueue] ${rows.length} pedidos encontrados. Enfileirando...`,
    );

    const sortedRows = [...rows].sort(
      (a, b) => a.collection_date.getTime() - b.collection_date.getTime(),
    );

    const todaysDate = new Date();
    const sevenDaysAgo = new Date(todaysDate);
    sevenDaysAgo.setUTCDate(todaysDate.getUTCDate() - 7);

    const allOrders = await ordersService.getFullOrdersByQuery({
      where: {
        date: {
          [Op.between]: [
            new Date(
              Date.UTC(
                sevenDaysAgo.getUTCFullYear(),
                sevenDaysAgo.getUTCMonth(),
                sevenDaysAgo.getUTCDate(),
                0,
                0,
                0,
                0,
              ),
            ),
            new Date(
              Date.UTC(
                todaysDate.getUTCFullYear(),
                todaysDate.getUTCMonth(),
                todaysDate.getUTCDate(),
                23,
                59,
                59,
                999,
              ),
            ),
          ],
        },
      },
      include: [
        {
          model: Customer,
          as: "customer",
        },
        {
          model: OrderItems,
          as: "items",
          attributes: ["sku"],
        },
      ],
    });

    const plainOrders = allOrders.map((order) =>
      order instanceof Model ? order.get({ plain: true }) : order,
    );

    await redisService.set(`orders_seven_days_ago`, plainOrders, {mode: 'EX', duration: 500})

    for (const row of sortedRows) {
      await this.next.add({ row }, `ml-sync-${row.order_number}`);
    }

    console.log(`[MLScrapingQueue] Enfileiramento concluído`);
  }
}
