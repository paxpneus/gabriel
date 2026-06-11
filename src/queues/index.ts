import { SalesReportQueue } from './../modules/reports/daily-sales/sales-report/sales-report.queue';
import { Express } from "express";
import { blingApi } from "../modules/handlers/bling/api/bling_api.service";

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

import BlingOrderService from "../modules/handlers/bling/services/bling-orders/bling-order.service";
import { BlingOrderQueue } from "../modules/handlers/bling/services/bling-orders/bling-order.queue";

import { CNPJQueue } from "../modules/handlers/cnpj/services/cnpj.queue";
import CNPJService from "../modules/handlers/cnpj/services/cnpj.service";

import { NFeQueue } from "./../modules/handlers/bling/services/bling-nfe/nfe.queue";
import { NFeValidationService } from "./../modules/handlers/bling/services/bling-nfe/nfe-validation.service";

import { MLScrapingQueue } from "../modules/handlers/mercado-livre/services/mercado-livre.scraping.queue";
import { MLScrapingService } from "../modules/handlers/mercado-livre/services/mercado-livre-scraping.service";
import { MLOrderService } from "../modules/handlers/mercado-livre/services/mercado-livre.service";
import { MLOrderSyncQueue } from "../modules/handlers/mercado-livre/services/mercado-livre-sync.queue";

import { ReconcilerQueue } from "../modules/handlers/bling/services/bling-nfe/nfe-reconciler.queue";
import { BlingReconcilerQueue } from "../modules/handlers/bling/services/bling-orders/bling-reconciler.queue";

import { BlingDirectUpsertQueue } from "./../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue";
import { BlingApiFetchQueue } from "../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { BlingTokenRefreshQueue } from './../modules/handlers/bling/services/bling/queues/bling-refresh-token.queue';
import { BlingMigrationQueue } from "../modules/handlers/bling/services/bling/queues/bling-daily-recover";
import { TCarMigrationQueue } from '../modules/handlers/tecinco/queues/tecinco-daily-recover';
import { DailyOperationReportQueue } from "../modules/reports/daily-operation-report/daily-operation-report.queue";
import { SefazDistribuicaoQueue } from '../modules/handlers/sefaz/services/sefaz-queue';
import { AutoBackupQueue } from '../modules/handlers/backup/auto-backup.queue';

export const serverAdapter = new ExpressAdapter();

/**
 * buildQueues(workless)
 *
 * workless = true  → só instancia Queue (produtor). Usado pelo container `api`.
 * workless = false → instancia Queue + Worker (consumidor). Usado pelo container `workers`.
 *
 * Isso evita ter dois Workers ativos consumindo a mesma fila ao mesmo tempo
 * (que é o que causava os 429 na Bling mesmo com limiter configurado).
 */
function buildQueues(workless: boolean) {
  const blingOrderService = new BlingOrderService(blingApi);

  const nfeQueue = new NFeQueue(new NFeValidationService(), blingApi, {
    workless,
  });

  const nfeNext = {
    addDelayed: (data: any, jobId: string, delay: number) =>
      nfeQueue.addDelayed(data, jobId, delay),
    removeJob: (jobId: string) => nfeQueue.removeJob(jobId),
    getJob: (jobId: string) => nfeQueue.getJob(jobId),
  };

  const mlOrderSyncQueue = new MLOrderSyncQueue(nfeNext, blingApi, {
    workless,
  });

  const cnpjQueue = new CNPJQueue(
    new CNPJService(),
    blingApi,
    { add: (data: any, jobId: string) => mlOrderSyncQueue.add(data, jobId) },
    { workless },
  );

  const cnpjNext = {
    add: (data: any, jobId: string) => cnpjQueue.add(data, jobId),
    getJob: (jobId: string) => cnpjQueue.getJob(jobId),
  };

  const blingOrderQueue = new BlingOrderQueue(
    blingOrderService,
    { add: (data, jobId) => cnpjQueue.add(data, jobId) },
    { workless },
  );

  const reconcilerQueue = new ReconcilerQueue(cnpjNext, nfeNext, blingApi, {
    workless,
  });

  const blingReconcilerQueue = new BlingReconcilerQueue(
    blingApi,
    { add: (data: any, jobId: string) => blingOrderQueue.add(data, jobId) },
    { workless },
  );

  const blingDirectUpsertQueue = new BlingDirectUpsertQueue({ workless });
  const blingApiFetchQueue = new BlingApiFetchQueue({ workless });
  const blingTokenRefreshQueue = new BlingTokenRefreshQueue({ workless })
  const blingDailyReconciler = new BlingMigrationQueue({ workless })
  // const tcarMigrationQueue = new TCarMigrationQueue({ workless })
  const dailyOperationReportQueue = new DailyOperationReportQueue({ workless })
  const dailySalesReportQueue = new SalesReportQueue({ workless })
  const autoBackupQueue = new AutoBackupQueue({ workless })

  return {
    nfeQueue,
    mlOrderSyncQueue,
    cnpjQueue,
    blingOrderQueue,
    reconcilerQueue,
    blingReconcilerQueue,
    blingDirectUpsertQueue,
    blingApiFetchQueue,
    blingTokenRefreshQueue,
    blingDailyReconciler,
    dailyOperationReportQueue,
    dailySalesReportQueue,
    autoBackupQueue,
    // tcarMigrationQueue
  };
}

// ─── Chamado pela API: registra filas + BullBoard, SEM subir Workers ──────────
export function registerQueues(app: Express) {
  const {
    nfeQueue,
    mlOrderSyncQueue,
    cnpjQueue,
    reconcilerQueue,
    blingReconcilerQueue,
    blingDirectUpsertQueue,
    blingApiFetchQueue,
    blingTokenRefreshQueue,
    blingDailyReconciler,
    dailyOperationReportQueue,
    dailySalesReportQueue,
    autoBackupQueue,
    // tcarMigrationQueue,
  } = buildQueues(true); // workless: true → zero Workers na API

   const blingOrderQueue = new BlingOrderQueue(
    new BlingOrderService(blingApi),
    { add: async () => {}},
    { workless: false },
  );

  // Scraping só para o BullBoard enxergar a fila, sem Worker
  const mlScrapingQueue = new MLScrapingQueue(
    new MLScrapingService(),
    new MLOrderService(),
    { add: (data, jobId) => mlOrderSyncQueue.add(data, jobId) },
    { concurrency: 1, lockDuration: 15 * 60 * 1000, workless: true },
  );
  const sefazQueue = new SefazDistribuicaoQueue({ workless: true });


  app.locals.BlingOrderQueue = blingOrderQueue;
  app.locals.CNPJQueue = cnpjQueue;
  app.locals.NfeQueue = nfeQueue;

  app.locals.BlingDirectUpsertQueue = blingDirectUpsertQueue;
  app.locals.BlingApiFetchQueue = blingApiFetchQueue;
  app.locals.BlingTokenRefreshQueue = blingTokenRefreshQueue;
  app.locals.BlingMigrationQueue = blingDailyReconciler;
  // app.locals.TCarMigrationQueue = tcarMigrationQueue;
  app.locals.DailyOperationReportQueue = dailyOperationReportQueue;
  app.locals.DailySalesReportQueue = dailySalesReportQueue
  app.locals.AutoBackupQueue = autoBackupQueue

  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [
      new BullMQAdapter(nfeQueue.queue),
      new BullMQAdapter(reconcilerQueue.queue),
      new BullMQAdapter(mlOrderSyncQueue.queue),
      new BullMQAdapter(cnpjQueue.queue),
      new BullMQAdapter(blingOrderQueue.queue),
      new BullMQAdapter(blingReconcilerQueue.queue),
      new BullMQAdapter(mlScrapingQueue.queue),
      new BullMQAdapter(blingDirectUpsertQueue.queue),
      new BullMQAdapter(blingApiFetchQueue.queue),
      new BullMQAdapter(blingTokenRefreshQueue.queue),
      new BullMQAdapter(blingDailyReconciler.queue),
      new BullMQAdapter(dailyOperationReportQueue.queue),
      new BullMQAdapter(dailySalesReportQueue.queue),
      new BullMQAdapter(autoBackupQueue.queue),
      // new BullMQAdapter(sefazQueue.queue)
    ],
    serverAdapter,
  });

  app.use("/admin/queues", serverAdapter.getRouter());

  console.log(
    "------------------- QUEUE: Filas registradas na API (sem Workers)! -------------------",
  );
}

// ─── Chamado pelo container workers: sobe Workers + agenda repetições ─────────
export function startWorkers() {
  // Mantém referência de TODAS as filas — sem isso o GC coleta as instâncias
  // e os Workers morrem silenciosamente logo após o start.
  const {
    nfeQueue,
    mlOrderSyncQueue,
    cnpjQueue,
    blingOrderQueue,
    reconcilerQueue,
    blingReconcilerQueue,
    blingTokenRefreshQueue,
    blingDailyReconciler,
    dailyOperationReportQueue,
    dailySalesReportQueue,
    autoBackupQueue,
  } = buildQueues(false); // workless: false → Worker ativo em cada fila

  // reconcilerQueue.scheduleRepeat({ every: 5 * 60 * 1000 });
  //TESTE
  // blingReconcilerQueue.scheduleRepeat({ every: 5 * 60 * 1000 });

  // blingTokenRefreshQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
  // blingDailyReconciler.scheduleRepeat({ every: 24 * 60 * 60 * 1000 });
  const sefazQueue = new SefazDistribuicaoQueue({ workless: false });
  dailyOperationReportQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
  autoBackupQueue.scheduleRepeat({ every: 24 * 60 * 60 * 1000 });
  // sefazQueue.scheduleRepeat({ every: 60 * 60 * 1000 });

  

  console.log("------------------- QUEUE: Workers Ativos! -------------------");
  console.log("  → NFE_EMISSION, ML-ORDER-SYNC, CNPJ_VERIFY_CNAE");
  console.log("  → BLING_ORDER_INGESTION, NFE_RECONCILER, BLING_RECONCILER");
  console.log("  → DAILY_OPERATION_REPORT, AUTO_BACKUP");
  
  // void sefazQueue;
}

// ─── Chamado pelo container worker-scraping ───────────────────────────────────
export function startScrapingWorker() {
  // mlOrderSyncQueue aqui só como produtor (workless: true)
  // quem consome ML-ORDER-SYNC é o container workers via startWorkers()
  const { mlOrderSyncQueue } = buildQueues(true);

  const mlScrapingQueue = new MLScrapingQueue(
    new MLScrapingService(),
    new MLOrderService(),
    { add: (data: any, jobId: string) => mlOrderSyncQueue.add(data, jobId) },
    { workless: false }, // scraping tem seu próprio Worker aqui
  );

  // mlScrapingQueue.scheduleRepeat({ every: 20 * 60 * 1000 });

  console.log(
    "------------------- QUEUE: Scraping Worker Ativo! -------------------",
  );
}
