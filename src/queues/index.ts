import { SalesReportQueue } from "./../modules/reports/daily-sales/sales-report/sales-report.queue";
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
import { BlingTokenRefreshQueue } from "./../modules/handlers/bling/services/bling/queues/bling-refresh-token.queue";
import { BlingMigrationQueue } from "../modules/handlers/bling/services/bling/queues/bling-daily-recover";
import { BlingStockMovementsScrapingQueue } from "../modules/handlers/bling/services/bling/queues/bling-stock-movements-scraping.queue";
import { TCarUpsertQueue } from "../modules/handlers/tecinco/queues/tecinco-api-fetch.queue";
import {
  scheduleTCarSync,
  TCarSyncQueue,
} from "../modules/handlers/tecinco/queues/tecinco-sync-queue";
import { DailyOperationReportQueue } from "../modules/reports/daily-operation/daily-operation-report/daily-operation-report.queue";
import { AutoBackupQueue } from "../modules/handlers/backup/auto-backup.queue";

import { BlingManifestacaoService } from "../modules/handlers/bling/services/bling-nfe/automations/auto-manifest/nfe-manifest-web-scraping.service";
import { BlingNfeScrapingQueue } from "../modules/handlers/bling/services/bling-nfe/automations/auto-manifest/nfe-manifest-web-scraping.queue";

import { CteIngestionQueue } from "../modules/handlers/fiscal/documents/cte/queues/cte-ingestion.queue";

export const serverAdapter = new ExpressAdapter();

// ─── Nomes canônicos de todas as filas ───────────────────────────────────────
export type QueueName =
  | "NFE_EMISSION"
  | "ML_ORDER_SYNC"
  | "CNPJ_VERIFY_CNAE"
  | "BLING_ORDER_INGESTION"
  | "NFE_RECONCILER"
  | "BLING_RECONCILER"
  | "BLING_DIRECT_UPSERT"
  | "BLING_API_FETCH"
  | "BLING_TOKEN_REFRESH"
  | "BLING_MIGRATION"
  | "BLING_STOCK_MOVEMENTS_SCRAPING"
  | "BLING_NFE_SCRAPING"
  | "TCAR_UPSERT"
  | "TCAR_SYNC"
  | "DAILY_OPERATION_REPORT"
  | "DAILY_SALES_REPORT"
  | "AUTO_BACKUP"
  | "CTE_INGESTION";

// ─── buildQueues: só ativa worker nas filas explicitamente listadas ───────────
function buildQueues(activeWorkers: QueueName[]) {
  const active = new Set<QueueName>(activeWorkers);
  const w = (name: QueueName) => !active.has(name); // workless = true se NÃO estiver na lista

  const blingOrderService = new BlingOrderService(blingApi);

  const nfeQueue = new NFeQueue(new NFeValidationService(), blingApi, {
    workless: w("NFE_EMISSION"),
  });

  const nfeNext = {
    addDelayed: (data: any, jobId: string, delay: number) =>
      nfeQueue.addDelayed(data, jobId, delay),
    removeJob: (jobId: string) => nfeQueue.removeJob(jobId),
    getJob: (jobId: string) => nfeQueue.getJob(jobId),
  };

  const mlOrderSyncQueue = new MLOrderSyncQueue(nfeNext, blingApi, {
    workless: w("ML_ORDER_SYNC"),
  });

  const cnpjQueue = new CNPJQueue(
    new CNPJService(),
    blingApi,
    { add: (data: any, jobId: string) => mlOrderSyncQueue.add(data, jobId) },
    { workless: w("CNPJ_VERIFY_CNAE") },
  );

  const cnpjNext = {
    add: (data: any, jobId: string) => cnpjQueue.add(data, jobId),
    getJob: (jobId: string) => cnpjQueue.getJob(jobId),
  };

  const blingOrderQueue = new BlingOrderQueue(
    blingOrderService,
    { add: (data, jobId) => cnpjQueue.add(data, jobId) },
    { workless: w("BLING_ORDER_INGESTION") },
  );

  const reconcilerQueue = new ReconcilerQueue(cnpjNext, nfeNext, blingApi, {
    workless: w("NFE_RECONCILER"),
  });

  const blingReconcilerQueue = new BlingReconcilerQueue(
    blingApi,
    { add: (data: any, jobId: string) => blingOrderQueue.add(data, jobId) },
    { workless: w("BLING_RECONCILER") },
  );

  const blingDirectUpsertQueue = new BlingDirectUpsertQueue({
    workless: w("BLING_DIRECT_UPSERT"),
  });
  const blingApiFetchQueue = new BlingApiFetchQueue({
    workless: w("BLING_API_FETCH"),
  });
  const blingTokenRefreshQueue = new BlingTokenRefreshQueue({
    workless: w("BLING_TOKEN_REFRESH"),
  });
  const blingDailyReconciler = new BlingMigrationQueue({
    workless: w("BLING_MIGRATION"),
  });
  const blingStockMovementsScrapingQueue =
    new BlingStockMovementsScrapingQueue({
      workless: w("BLING_STOCK_MOVEMENTS_SCRAPING"),
    });
  const tcarUpsertQueue = new TCarUpsertQueue({ workless: w("TCAR_UPSERT") });
  const tcarSyncQueue = new TCarSyncQueue(tcarUpsertQueue, {
    workless: w("TCAR_SYNC"),
  });
  const dailyOperationReportQueue = new DailyOperationReportQueue({
    workless: w("DAILY_OPERATION_REPORT"),
  });
  const dailySalesReportQueue = new SalesReportQueue({
    workless: w("DAILY_SALES_REPORT"),
  });
  const autoBackupQueue = new AutoBackupQueue({ workless: w("AUTO_BACKUP") });

  const blingNfeScrapingQueue = new BlingNfeScrapingQueue(
    new BlingManifestacaoService(),
    { workless: true },
  );

  const cteIngestionQueue = new CteIngestionQueue({ workless: w("CTE_INGESTION") }); 

  
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
    blingStockMovementsScrapingQueue,
    dailyOperationReportQueue,
    dailySalesReportQueue,
    autoBackupQueue,
    tcarUpsertQueue,
    tcarSyncQueue,
    blingNfeScrapingQueue,
    cteIngestionQueue,
  };
}

// ─── API: registra filas + BullBoard, SEM Workers ────────────────────────────
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
    blingStockMovementsScrapingQueue,
    dailyOperationReportQueue,
    dailySalesReportQueue,
    autoBackupQueue,
    tcarUpsertQueue,
    tcarSyncQueue,
    blingNfeScrapingQueue,
    cteIngestionQueue,
  } = buildQueues([]);

  const blingOrderQueue = new BlingOrderQueue(
    new BlingOrderService(blingApi),
    { add: async () => {} },
    { workless: true },
  );

  const mlScrapingQueue = new MLScrapingQueue(
    new MLScrapingService(),
    new MLOrderService(),
    { add: (data, jobId) => mlOrderSyncQueue.add(data, jobId) },
    { workless: true },
  );

  app.locals.BlingOrderQueue = blingOrderQueue;
  app.locals.CNPJQueue = cnpjQueue;
  app.locals.NfeQueue = nfeQueue;
  app.locals.MLOrderSyncQueue = mlOrderSyncQueue;
  app.locals.BlingDirectUpsertQueue = blingDirectUpsertQueue;
  app.locals.BlingApiFetchQueue = blingApiFetchQueue;
  app.locals.BlingTokenRefreshQueue = blingTokenRefreshQueue;
  app.locals.BlingMigrationQueue = blingDailyReconciler;
  app.locals.BlingStockMovementsScrapingQueue = blingStockMovementsScrapingQueue;
  app.locals.TCarUpsertQueue = tcarUpsertQueue;
  app.locals.DailyOperationReportQueue = dailyOperationReportQueue;
  app.locals.DailySalesReportQueue = dailySalesReportQueue;
  app.locals.AutoBackupQueue = autoBackupQueue;
  app.locals.TCarSyncQueue = tcarSyncQueue;

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
      new BullMQAdapter(blingStockMovementsScrapingQueue.queue),
      new BullMQAdapter(dailyOperationReportQueue.queue),
      new BullMQAdapter(dailySalesReportQueue.queue),
      new BullMQAdapter(autoBackupQueue.queue),
      new BullMQAdapter(tcarUpsertQueue.queue),
      new BullMQAdapter(tcarSyncQueue.queue),
      new BullMQAdapter(blingNfeScrapingQueue.queue),
      new BullMQAdapter(cteIngestionQueue.queue),
    ],
    serverAdapter,
  });

  app.use("/admin/queues", serverAdapter.getRouter());

  console.log(
    "------------------- QUEUE: Filas registradas na API (sem Workers)! -------------------",
  );
}

// ─── container: workers ───────────────────────────────────────────────────────
export function startBlingWorkers() {
  const {
    blingApiFetchQueue,
    blingDirectUpsertQueue,
    blingTokenRefreshQueue,
    blingDailyReconciler,
    blingOrderQueue,
  } = buildQueues([
    "BLING_API_FETCH",
    "BLING_DIRECT_UPSERT",
    "BLING_TOKEN_REFRESH",
    "BLING_MIGRATION",
    "BLING_ORDER_INGESTION",
  ]);

  blingTokenRefreshQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
  blingDailyReconciler.scheduleRepeat({ every: 24 * 60 * 60 * 1000 });

  void blingApiFetchQueue;
  void blingDirectUpsertQueue;
  void blingOrderQueue;

  console.log(
    "------------------- QUEUE: Bling Workers Ativos! -------------------",
  );
  console.log("  → BLING_API_FETCH");
  console.log("  → BLING_DIRECT_UPSERT");
  console.log("  → BLING_TOKEN_REFRESH (1h)");
  console.log("  → BLING_MIGRATION (24h)");
  console.log("  → TCAR_UPSERT");
}

// ─── container: worker-automation ────────────────────────────────────────────
export function startAutomationWorkers() {
  const {
    nfeQueue,
    mlOrderSyncQueue,
    cnpjQueue,
    reconcilerQueue,
    blingReconcilerQueue,
  } = buildQueues([
    "NFE_EMISSION",
    "ML_ORDER_SYNC",
    "CNPJ_VERIFY_CNAE",
    "NFE_RECONCILER",
    "BLING_RECONCILER",
  ]);

  reconcilerQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
  
    blingReconcilerQueue.scheduleRepeat({
    every: 2 * 60 * 60 * 1000,
    jobId: "bling-reconciler-open-orders",
    data: { task: "reconcile-open-orders" },
  });

  blingReconcilerQueue.scheduleRepeat({
    every: 30 * 60 * 1000,
    jobId: "bling-reconciler-invoiced-or-collected",
    data: { task: "sync-invoiced-or-collected" },
  });

  void nfeQueue;
  void mlOrderSyncQueue;
  void cnpjQueue;
  void reconcilerQueue;
  void blingReconcilerQueue;

  console.log(
    "------------------- QUEUE: Automation Workers Ativos! -------------------",
  );
  console.log("  → BLING_ORDER_INGESTION");
  console.log("  → CNPJ_VERIFY_CNAE");
  console.log("  → ML_ORDER_SYNC");
  console.log("  → NFE_EMISSION");
  console.log("  → NFE_RECONCILER (1h)");
  console.log("  → BLING_RECONCILER (2h)");
}

// ─── container: workers (relatórios e backup) ────────────────────────────────
export function startWorkers() {
  const {
    dailyOperationReportQueue,
    dailySalesReportQueue,
    autoBackupQueue,
    cteIngestionQueue,
  } = buildQueues([
    "DAILY_OPERATION_REPORT",
    "DAILY_SALES_REPORT",
    "AUTO_BACKUP",
    "CTE_INGESTION",
  ]);

  dailyOperationReportQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
  autoBackupQueue.scheduleRepeat({
    cron: "0 19 * * *",
    tz: "America/Sao_Paulo",
  });
  cteIngestionQueue.scheduleRepeat({ every: 30 * 1000 });

  setTimeout(
    () => {
      dailySalesReportQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
     
    },
    30 * 60 * 1000,
  );

  void dailyOperationReportQueue;
  void autoBackupQueue;
  void cteIngestionQueue;

  console.log("🚀 Workers de relatórios/backup ativos:");
  console.log("  → DAILY_OPERATION_REPORT (1h)");
  console.log("  → DAILY_SALES_REPORT (1h, offset 30min)");
  console.log("  → AUTO_BACKUP (19h BRT)");
  console.log("  → CTE_INGESTION (30min)");
}

export function startTecincoWorkers() {
  const { tcarUpsertQueue, tcarSyncQueue } = buildQueues([
    "TCAR_UPSERT",
    "TCAR_SYNC",
  ]);

  scheduleTCarSync(tcarSyncQueue, tcarUpsertQueue);

  void tcarUpsertQueue;
  void tcarSyncQueue;

  console.log("🚀 Workers da Tecinco ativos!:");
  console.log("  → TCAR_SYNC (10min)!");
}

// ─── container: worker-scraping ───────────────────────────────────────────────
export function startScrapingWorker() {
  const { mlOrderSyncQueue, blingStockMovementsScrapingQueue } = buildQueues([
    "BLING_STOCK_MOVEMENTS_SCRAPING",
    "BLING_NFE_SCRAPING"
  ]);

  const mlScrapingQueue = new MLScrapingQueue(
    new MLScrapingService(),
    new MLOrderService(),
    { add: (data: any, jobId: string) => mlOrderSyncQueue.add(data, jobId) },
    { workless: false },
  );

  mlScrapingQueue.scheduleRepeat({ every: 20 * 60 * 1000 });

  const blingNfeScrapingQueue = new BlingNfeScrapingQueue(
    new BlingManifestacaoService(),
    { workless: false },
  );

  blingNfeScrapingQueue.scheduleRepeat({ every: 3 * 60 * 60 * 1000 });
  blingStockMovementsScrapingQueue.scheduleRepeat({
    cron: "0 5 * * *",
    tz: "America/Sao_Paulo",
    jobId: "bling-stock-movements-daily",
  });

  void mlScrapingQueue;
  void blingNfeScrapingQueue;
  void blingStockMovementsScrapingQueue;

  console.log(
    "------------------- QUEUE: Scraping Worker Ativo! -------------------",
  );
  console.log("  → BLING_STOCK_MOVEMENTS_SCRAPING (05:00 BRT)");
}
