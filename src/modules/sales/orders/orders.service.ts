import BaseService from "../../../shared/utils/base-models/base-service";
import Customer from "../customers/customers.model";
import Order from "./orders.model";
import orderRepository, { OrderRepository } from "./orders.repository";
import { FullOrder } from "./orders.types";

export class OrderService extends BaseService<Order, OrderRepository> {
    constructor() {
        super(orderRepository);
    }

    async getFullOrder (id: string): Promise<FullOrder> {

        const orderData = await this.repository.findOne({
            where: {id},
            include: [
                {
                    model: Customer,
                    as: 'customer'
                }
            ]
        })

        if (!orderData) throw new Error("Pedido não encontrado.")

        return orderData as unknown as Promise<FullOrder>
        
    } 

}

export default new OrderService();