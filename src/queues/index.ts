import { Express } from "express";
import { blingApi } from "../modules/handlers/bling/api/bling_api.service";


import BlingOrderService from "../modules/handlers/bling/services/bling-orders/bling-order.service";
import { BlingOrderQueue } from "../modules/handlers/bling/services/bling-orders/bling-order.queue";


import { CNPJQueue } from "../modules/handlers/cnpj/services/cnpj.queue";
import CNPJService from "../modules/handlers/cnpj/services/cnpj.service";


import { MLOrderQueue } from "../modules/handlers/mercado-livre/services/mercado-livre.queue";
import { MLOrderService } from "../modules/handlers/mercado-livre/services/mercado-livre.service";


import { NFeQueue } from "../modules/handlers/bling/services/bling-nfe/nfe.queue";
import { NFeValidationService } from './../modules/handlers/bling/services/bling-nfe/nfe-validation.service';
import { MLScrapingQueue } from "../modules/handlers/mercado-livre/services/mercado-livre.scraping.queue";
import { MLScrapingService } from "../modules/handlers/mercado-livre/services/mercado-livre-scraping.service";


export function initQueues(app: Express) {

    // Instâncias das filas


    const nfeQueue = new NFeQueue(new NFeValidationService(), blingApi);

    const mlScrapingQueue = new MLScrapingQueue(
        new MLScrapingService(),
        new MLOrderService(),
        {
            addDelayed: (data,jobId, delay) => nfeQueue.addDelayed(data, jobId, delay),
            removeJob: (jobId) => nfeQueue.removeJob(jobId)
        }
    )
    
    const mlOrderQueue = new MLOrderQueue(new MLOrderService(), blingApi, {
        addDelayed: (data, jobId, delay) => nfeQueue.addDelayed(data, jobId, delay)
    });

    const cnpjQueue = new CNPJQueue(new CNPJService(), blingApi, {
        add: (data, jobId) => mlOrderQueue.add(data, jobId)
    })

    const blingOrderQueue = new BlingOrderQueue(new BlingOrderService(blingApi), {
        add: (data, jobId) => cnpjQueue.add(data, jobId)
    })

    // mlScrapingQueue.scheduleRepeat({ every: 10 * 60 * 1000 })
    // mlScrapingQueue.scheduleRepeat({ every: 30 * 1000 })

    app.locals.BlingOrderQueue = blingOrderQueue;
    app.locals.CNPJQueue       = cnpjQueue;
    app.locals.NfeQueue        = nfeQueue;
    app.locals.MlOrderQueue    = mlOrderQueue;

    console.log('------------------- QUEUE: Workers Ativos! -------------------')

}