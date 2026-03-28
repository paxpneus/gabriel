import BaseRepository from "../../../shared/utils/base-models/base-repository";
import OrderHistory from "./order_history.model";

export class OrderHistoryRepository extends BaseRepository<OrderHistory> {
    constructor() {
        super(OrderHistory);
    }
}
export default new OrderHistoryRepository();