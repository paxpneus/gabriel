import BaseService from "../../../shared/utils/base-models/base-service";
import OrderHistory from "./order_history.model";
import orderHistoryRepository, { OrderHistoryRepository } from "./order_history.repository";

export class OrderHistoryService extends BaseService<OrderHistory, OrderHistoryRepository> {
    constructor() {
        super(orderHistoryRepository);
    }

}
export default new OrderHistoryService();