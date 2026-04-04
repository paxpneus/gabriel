import BaseController from "../../../../shared/utils/base-models/base-controller";
import orderService, { OrderService } from "./orders.service";
import Order from "./orders.model";

class OrderController extends BaseController<Order, OrderService> {
    constructor() {
        super(orderService);
    }
}

export default new OrderController();