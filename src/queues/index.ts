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

  const nfeQueue = new NFeQueue(
    new NFeValidationService(),
    blingApi,
    { workless },
  );

  const nfeNext = {
    addDelayed: (data: any, jobId: string, delay: number) =>
      nfeQueue.addDelayed(data, jobId, delay),
    removeJob: (jobId: string) => nfeQueue.removeJob(jobId),
    getJob: (jobId: string) => nfeQueue.getJob(jobId),
  };

  const mlOrderSyncQueue = new MLOrderSyncQueue(nfeNext, blingApi, { workless });

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

  const reconcilerQueue = new ReconcilerQueue(cnpjNext, nfeNext, blingApi, { workless });

  const blingReconcilerQueue = new BlingReconcilerQueue(
    blingApi,
    { add: (data: any, jobId: string) => blingOrderQueue.add(data, jobId) },
    { workless },
  );

  return {
    nfeQueue,
    mlOrderSyncQueue,
    cnpjQueue,
    blingOrderQueue,
    reconcilerQueue,
    blingReconcilerQueue,
  };
}

// ─── Chamado pela API: registra filas + BullBoard, SEM subir Workers ──────────
export function registerQueues(app: Express) {
  const {
    nfeQueue,
    mlOrderSyncQueue,
    cnpjQueue,
    blingOrderQueue,
    reconcilerQueue,
    blingReconcilerQueue,
  } = buildQueues(true); // workless: true → zero Workers na API

  // Scraping só para o BullBoard enxergar a fila, sem Worker
  const mlScrapingQueue = new MLScrapingQueue(
    new MLScrapingService(),
    new MLOrderService(),
    { add: (data, jobId) => mlOrderSyncQueue.add(data, jobId) },
    { concurrency: 1, lockDuration: 15 * 60 * 1000, workless: true },
  );

  app.locals.BlingOrderQueue = blingOrderQueue;
  app.locals.CNPJQueue = cnpjQueue;
  app.locals.NfeQueue = nfeQueue;

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
    ],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());

  console.log("------------------- QUEUE: Filas registradas na API (sem Workers)! -------------------");
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
  } = buildQueues(false); // workless: false → Worker ativo em cada fila

  reconcilerQueue.scheduleRepeat({ every: 5 * 60 * 1000 });
  blingReconcilerQueue.scheduleRepeat({ every: 5 * 60 * 1000 });

  console.log("------------------- QUEUE: Workers Ativos! -------------------");
  console.log("  → NFE_EMISSION, ML-ORDER-SYNC, CNPJ_VERIFY_CNAE");
  console.log("  → BLING_ORDER_INGESTION, NFE_RECONCILER, BLING_RECONCILER");
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

  mlScrapingQueue.scheduleRepeat({ every: 20 * 60 * 1000 });

  console.log('------------------- QUEUE: Scraping Worker Ativo! -------------------');
}