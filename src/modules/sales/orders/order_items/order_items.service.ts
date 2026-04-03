import BaseService from "../../../../shared/utils/base-models/base-service";
import OrderItems from "./order_items.model";
import orderItemsRepository, { OrderItemsRepository } from "./order_items.repository";

export class OrderItemsService extends BaseService<OrderItems, OrderItemsRepository> {
    constructor() {
        super(orderItemsRepository)
    }
}

export default new OrderItemsService();