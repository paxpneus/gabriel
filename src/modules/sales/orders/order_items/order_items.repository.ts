import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import OrderItems from "./order_items.model";

export class OrderItemsRepository extends BaseRepository<OrderItems> {
    constructor() {
        super(OrderItems);
    }
}

export default new OrderItemsRepository();