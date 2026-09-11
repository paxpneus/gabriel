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
import { SCRAPING_SHARED_QUEUE_LOCK } from "../../bling/services/bling/queues/scraping-queue-lock";
import { OrderInternalStatus } from "../../../sales/orders/order/orders.types";
import { matchesOrderByDateAndBuyer } from "./helpers/order-match";
import { MLExcelRow } from "./mercado-livre.types";

export class MLScrapingQueue extends BaseQueueService<MLScrapingJobData> {
  private scrapingService: MLScrapingService;
  private mlOrderService: MLOrderService;
  private next: nextStepOnQueue;

  constructor(
    scrapingService: MLScrapingService,
    mlOrderService: MLOrderService,
    next: nextStepOnQueue,
    options: { workless?: boolean } = {}
  ) {
    super("ML-SCRAPING", {
      concurrency: 1,
      lockDuration: 15 * 60 * 1000,
      maxProcessingMs: 5 * 60 * 1000,
      sharedLock: SCRAPING_SHARED_QUEUE_LOCK,
      workless: options?.workless,
    });
    this.scrapingService = scrapingService;
    this.mlOrderService = mlOrderService;
    this.next = next;
  }

  async process(job: Job<MLScrapingJobData>): Promise<void> {
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

    // Scraping é sob demanda agora (sem cron fixo) — antes de baixar/parsear
    // a planilha inteira (caro: Playwright + jitter), confere se ainda tem
    // ALGUM pedido pendente de collection_date. Se não tiver mais nenhum
    // (ex: já resolvido por dataPrevista, ou por um ciclo anterior que
    // rodou antes deste), o disparo que gerou este job já perdeu o motivo
    // de existir — não vale a pena rodar o ciclo inteiro.
    const pendingOrders = plainOrders.filter(
      (order: any) =>
        order.internal_status === OrderInternalStatus.WAITING_CHANNEL_VALIDATION &&
        !order.collection_date,
    );

    if (pendingOrders.length === 0) {
      console.log(
        `[MLScrapingQueue] Nenhum pedido pendente de collection_date no momento — pulando ciclo.`,
      );
      return;
    }

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

    const sortedRows = [...rows].sort(
      (a, b) => a.collection_date.getTime() - b.collection_date.getTime(),
    );

    // Só enfileira linha que possa corresponder a um pedido genuinamente
    // pendente — evita criar um job de ML_ORDER_SYNC (com leitura no banco
    // e, se der match, chamadas na Bling) pra cada uma das ~centenas de
    // linhas da planilha quando só um punhado de pedidos precisa de fato
    // ser resolvido agora. A busca de "irmãos" (mesmo cliente/SKU) dentro
    // de MLOrderSyncQueue.syncFromExcel continua usando a lista completa
    // (orders_seven_days_ago, gravada abaixo sem filtro) — o filtro aqui só
    // decide QUAIS linhas viram job, não contra quais pedidos elas casam.
    const relevantRows = sortedRows.filter((row: MLExcelRow) =>
      pendingOrders.some((order: any) =>
        matchesOrderByDateAndBuyer(order.date, order.customer?.name, row),
      ),
    );

    await redisService.set(`orders_seven_days_ago`, plainOrders, {
      mode: "EX",
      duration: 60 * 30,
    });

    console.log(
      `[MLScrapingQueue] ${relevantRows.length}/${rows.length} linha(s) relevante(s) para ${pendingOrders.length} pedido(s) pendente(s). Enfileirando...`,
    );

    for (const row of relevantRows) {
      await this.next.add({ row }, `ml-sync-${row.order_number}`);
    }

    console.log(`[MLScrapingQueue] Enfileiramento concluído`);
  }
}
