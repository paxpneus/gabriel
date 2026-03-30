import { blingApi } from "../modules/handlers/bling/api/bling_api.service";
import BlingOrderService from "../modules/handlers/bling/services/bling-orders/bling-order.service";
import { BlingOrderQueue } from "../modules/handlers/bling/services/bling-orders/bling-order.queue";
import { Express } from "express";

export function initQueues(app: Express) {
    const blingOrderService = new BlingOrderService(blingApi)
    app.locals.BlingOrderQueue = new BlingOrderQueue(blingOrderService)

    console.log('------------------- QUEUE: Workers Ativos! -------------------')

}