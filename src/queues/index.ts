import { Express } from "express";
import { blingApi } from "../modules/handlers/bling/api/bling_api.service";

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import BlingOrderService from "../modules/handlers/bling/services/bling-orders/bling-order.service";
import { BlingOrderQueue } from "../modules/handlers/bling/services/bling-orders/bling-order.queue";

import { CNPJQueue } from "../modules/handlers/cnpj/services/cnpj.queue";
import CNPJService from "../modules/handlers/cnpj/services/cnpj.service";

import { MLOrderQueue } from "../modules/handlers/mercado-livre/services/mercado-livre.queue";
import { MLOrderService } from "../modules/handlers/mercado-livre/services/mercado-livre.service";

import { NFeQueue } from "../modules/handlers/bling/services/bling-nfe/nfe.queue";
import { NFeValidationService } from "./../modules/handlers/bling/services/bling-nfe/nfe-validation.service";

import { MLScrapingQueue } from "../modules/handlers/mercado-livre/services/mercado-livre.scraping.queue";
import { MLScrapingService } from "../modules/handlers/mercado-livre/services/mercado-livre-scraping.service";
import { MLOrderSyncQueue } from "../modules/handlers/mercado-livre/services/mercado-livre-sync.queue";

import { NFeReconcilerQueue } from "../modules/handlers/bling/services/bling-nfe/nfe-reconciler.queue";

export const serverAdapter = new ExpressAdapter();

export function initQueues(app: Express) {
  // Instâncias das filas

  const nfeQueue = new NFeQueue(new NFeValidationService(), blingApi);

  const nfeNext = {
    addDelayed: (data: any, jobId: string, delay: number) =>
      nfeQueue.addDelayed(data, jobId, delay),
    removeJob: (jobId: string) => nfeQueue.removeJob(jobId),
    getJob: (jobId: string) => nfeQueue.getJob(jobId),
  };

    const nfeReconcilerQueue = new NFeReconcilerQueue(nfeNext);


  const mlOrderSyncQueue = new MLOrderSyncQueue(nfeNext, blingApi);

  const mlScrapingQueue = new MLScrapingQueue(
    new MLScrapingService(),
    new MLOrderService(),
    { add: (data: any, jobId: string) => mlOrderSyncQueue.add(data, jobId) },
  );

  const mlOrderQueue = new MLOrderQueue({
    add: (data: any, jobId: string) => mlOrderSyncQueue.add(data, jobId),
  });

  const cnpjQueue = new CNPJQueue(new CNPJService(), blingApi, {
    add: (data, jobId) => mlOrderQueue.add(data, jobId),
  });

  const blingOrderQueue = new BlingOrderQueue(new BlingOrderService(blingApi), {
    add: (data, jobId) => cnpjQueue.add(data, jobId),
  });

  mlScrapingQueue.scheduleRepeat({ every: 10 * 60 * 1000 });
  nfeReconcilerQueue.scheduleRepeat({ every: 5 * 60* 1000 })
  // mlScrapingQueue.scheduleRepeat({ every: 2 * 60 * 1000 })

  app.locals.BlingOrderQueue = blingOrderQueue;
  app.locals.CNPJQueue = cnpjQueue;
  app.locals.NfeQueue = nfeQueue;

  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(nfeQueue.queue),
      new BullMQAdapter(nfeReconcilerQueue.queue),
      new BullMQAdapter(mlOrderSyncQueue.queue),
      new BullMQAdapter(mlScrapingQueue.queue),
      new BullMQAdapter(mlOrderQueue.queue),
      new BullMQAdapter(cnpjQueue.queue),
      new BullMQAdapter(blingOrderQueue.queue)
    ],
    serverAdapter 
  })

  console.log("------------------- QUEUE: Workers Ativos! -------------------");
}


