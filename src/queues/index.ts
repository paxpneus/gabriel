import { NFeValidationService } from './../modules/handlers/bling/services/bling-nfe/nfe-validation.service';
import { blingApi } from "../modules/handlers/bling/api/bling_api.service";
import BlingOrderService from "../modules/handlers/bling/services/bling-orders/bling-order.service";
import { BlingOrderQueue } from "../modules/handlers/bling/services/bling-orders/bling-order.queue";
import { Express } from "express";
import { CNPJQueue } from "../modules/handlers/cnpj/services/cnpj.queue";
import CNPJService from "../modules/handlers/cnpj/services/cnpj.service";
import { MLOrderQueue } from "../modules/handlers/mercado-livre/services/mercado-livre.queue";
import { MLOrderService } from "../modules/handlers/mercado-livre/services/mercado-livre.service";
import { NFeQueue } from "../modules/handlers/bling/services/bling-nfe/nfe.queue";

export function initQueues(app: Express) {
    const nfeValidationService = new NFeValidationService()
    const nfeQueue = new NFeQueue(blingApi, nfeValidationService)

    const mlOrderService = new MLOrderService()
    const mlOrderQueue = new MLOrderQueue(mlOrderService, blingApi, nfeQueue)

    const cnpjQueue = new CNPJQueue(new CNPJService(), blingApi, mlOrderQueue)
    const blingOrderService = new BlingOrderService(blingApi, cnpjQueue)

    app.locals.BlingOrderQueue = new BlingOrderQueue(blingOrderService)
    app.locals.CNPJQueue = cnpjQueue
    app.locals.NfeQueue = nfeQueue
    app.locals.MlOrderQueue = mlOrderQueue

    console.log('------------------- QUEUE: Workers Ativos! -------------------')

}