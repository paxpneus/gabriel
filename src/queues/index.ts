import { blingApi } from "../modules/handlers/bling/api/bling_api.service";
import BlingOrderService from "../modules/handlers/bling/services/bling-orders/bling-order.service";
import { BlingOrderQueue } from "../modules/handlers/bling/services/bling-orders/bling-order.queue";
import { Express } from "express";
import { CNPJQueue } from "../modules/handlers/cnpj/services/cnpj.queue";
import CNPJService from "../modules/handlers/cnpj/services/cnpj.service";

export function initQueues(app: Express) {
    const cnpjQueue = new CNPJQueue(new CNPJService(), blingApi)
    const blingOrderService = new BlingOrderService(blingApi, cnpjQueue)
    app.locals.BlingOrderQueue = new BlingOrderQueue(blingOrderService)
    app.locals.CNPJQueue = cnpjQueue

    console.log('------------------- QUEUE: Workers Ativos! -------------------')

}