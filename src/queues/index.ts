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


export function initQueues(app: Express) {

    // Instâncias das filas
    const nfeQueue = new NFeQueue(new NFeValidationService(), blingApi);
    const mlOrderQueue = new MLOrderQueue(new MLOrderService(), blingApi);
    const cnpjQueue = new CNPJQueue(new CNPJService(), blingApi)
    const blingOrderQueue = new BlingOrderQueue(new BlingOrderService(blingApi))

    // Work flow das filas

    // Cada service emite um evento node que entra na fila

    blingOrderQueue.on('order.ready_for_cnpj', ({customer, cnaes, order}) => {
        cnpjQueue.add({customer, cnaes, order}, `document-check-${customer.id}`)
    })

    cnpjQueue.on('cnpj.approved', ({order, customer}) => {
        mlOrderQueue.add({order, customer}, `ml-check-${order.id}`)
    })

    mlOrderQueue.on('ml.fetched', ({order_id, collection_date, delay}) => {
        nfeQueue.addDelayed({ order_id, collection_date }, `nfe-generation-${order_id}`, delay)
    })

    app.locals.BlingOrderQueue = blingOrderQueue;
    app.locals.CNPJQueue       = cnpjQueue;
    app.locals.NfeQueue        = nfeQueue;
    app.locals.MlOrderQueue    = mlOrderQueue;

    console.log('------------------- QUEUE: Workers Ativos! -------------------')

}