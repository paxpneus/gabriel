import BaseController from "../../../../shared/utils/base-models/base-controller";
import OrderHistory from "./order_history.model";
import orderHistoryService, { OrderHistoryService } from "./order_history.service";

class OrderHistoryController extends BaseController<OrderHistory, OrderHistoryService> {
    constructor() {
        super(orderHistoryService);
    }
}
export default new OrderHistoryController();