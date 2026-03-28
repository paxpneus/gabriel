import BaseService from "../../../shared/utils/base-models/base-service";
import Order from "./orders.model";
import orderRepository, { OrderRepository } from "./orders.repository";

export class OrderService extends BaseService<Order, OrderRepository> {
    constructor() {
        super(orderRepository);
    }

}

export default new OrderService();