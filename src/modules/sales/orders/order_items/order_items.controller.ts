import BaseController from "../../../../shared/utils/base-models/base-controller";
import OrderItems from "./order_items.model";
import orderItemsService, { OrderItemsService } from "./order_items.service";

class OrderItemsController extends BaseController<OrderItems, OrderItemsService> {
    constructor() {
        super(orderItemsService)
    }
}

export default new OrderItemsController();