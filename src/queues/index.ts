import { Express } from "express";
import { blingApi } from "../modules/handlers/bling/api/bling_api.service";

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

import BlingOrderService from "../modules/handlers/bling/services/bling-orders/bling-order.service";
import { BlingOrderQueue } from "../modules/handlers/bling/services/bling-orders/bling-order.queue";

import { CNPJQueue } from "../modules/handlers/cnpj/services/cnpj.queue";
import CNPJService from "../modules/handlers/cnpj/services/cnpj.service";

import { NFeQueue } from "../modules/handlers/bling/services/bling-nfe/nfe.queue";
import { NFeValidationService } from "./../modules/handlers/bling/services/bling-nfe/nfe-validation.service";

import { MLScrapingQueue } from "../modules/handlers/mercado-livre/services/mercado-livre.scraping.queue";
import { MLScrapingService } from "../modules/handlers/mercado-livre/services/mercado-livre-scraping.service";
import { MLOrderService } from "../modules/handlers/mercado-livre/services/mercado-livre.service";
import { MLOrderSyncQueue } from "../modules/handlers/mercado-livre/services/mercado-livre-sync.queue";

import { ReconcilerQueue } from "../modules/handlers/bling/services/bling-nfe/nfe-reconciler.queue";
import { BlingReconcilerQueue } from "../modules/handlers/bling/services/bling-orders/bling-reconciler.queue";

export const serverAdapter = new ExpressAdapter();

// ─── Monta todas as instâncias de fila (compartilhado entre as duas funções) ──
function buildQueues() {
  const blingOrderService = new BlingOrderService(blingApi);

  const nfeQueue = new NFeQueue(new NFeValidationService(), blingApi);

  const nfeNext = {
    addDelayed: (data: any, jobId: string, delay: number) =>
      nfeQueue.addDelayed(data, jobId, delay),
    removeJob: (jobId: string) => nfeQueue.removeJob(jobId),
    getJob: (jobId: string) => nfeQueue.getJob(jobId),
  };

  const mlOrderSyncQueue = new MLOrderSyncQueue(nfeNext, blingApi);


  const cnpjQueue = new CNPJQueue(new CNPJService(), blingApi, {
    add: (data: any, jobId: string) => mlOrderSyncQueue.add(data, jobId),
  });

  const cnpjNext = {
    add: (data: any, jobId: string) => cnpjQueue.add(data, jobId),
    getJob: (jobId: string) => cnpjQueue.getJob(jobId),
  };

  const blingOrderQueue = new BlingOrderQueue(blingOrderService, {
    add: (data, jobId) => cnpjQueue.add(data, jobId),
  });

  const reconcilerQueue = new ReconcilerQueue(cnpjNext, nfeNext, blingApi);

  const blingOrderNext = {
    add: (data: any, jobId: string) => blingOrderQueue.add(data, jobId),
  };

  const blingReconcilerQueue = new BlingReconcilerQueue(
    blingApi,
    blingOrderNext,
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

function buildMLScrapingQueueRef(mlOrderSyncQueue: MLOrderSyncQueue) {
  return new MLScrapingQueue(
    new MLScrapingService(),
    new MLOrderService(),
    { add: (data, jobId) => mlOrderSyncQueue.add(data, jobId) },
    { concurrency: 1, lockDuration: 15 * 60 * 1000, workless: true }, // só fila, sem worker
  );
}

// ─── Chamado pela API: registra filas no app.locals + BullBoard ───────────────
// Não sobe Workers — só permite que as rotas enfileirem jobs via app.locals
export function registerQueues(app: Express) {
  const {
    nfeQueue,
    mlOrderSyncQueue,
    cnpjQueue,
    blingOrderQueue,
    reconcilerQueue,
    blingReconcilerQueue,
  } = buildQueues();
  const mlScrapingQueue = buildMLScrapingQueueRef(mlOrderSyncQueue)

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

  app.use('/admin/queues', serverAdapter.getRouter())


  console.log("------------------- QUEUE: Filas registradas na API! -------------------");
}

// ─── Chamado pelos workers: sobe os Workers e agenda repetições ───────────────
// Não registra no app.locals — só processa jobs do Redis
export function startWorkers() {
  const { reconcilerQueue, blingReconcilerQueue } = buildQueues();


  reconcilerQueue.scheduleRepeat({ every: 5 * 60 * 1000 });
  blingReconcilerQueue.scheduleRepeat({ every: 6 * 60 * 60 * 1000 });

  console.log("------------------- QUEUE: Workers Ativos! -------------------");
}

export function startScrapingWorker() {
  const { mlOrderSyncQueue } = buildQueues()

  const mlScrapingQueue = new MLScrapingQueue(
    new MLScrapingService(),
    new MLOrderService(),
    { add: (data: any, jobId: string) => mlOrderSyncQueue.add(data, jobId) },
  )

  mlScrapingQueue.scheduleRepeat({ every: 20 * 60 * 1000 })

  console.log('------------------- QUEUE: Scraping Worker Ativo! -------------------')
}