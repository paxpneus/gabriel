import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Order from "./orders.model";

export class OrderRepository extends BaseRepository<Order> {
    constructor() {
        super(Order);
    }
}

export default new OrderRepository();