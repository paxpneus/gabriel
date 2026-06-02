import { FindOptions, Op } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Customer from "../../customers/customers.model";
import Order from "./orders.model";
import orderRepository, { OrderRepository } from "./orders.repository";
import { FullOrder } from "./orders.types";
import { QueryParams, PaginatedResult } from "../../../../shared/query/query.types";

export class OrderService extends BaseService<Order, OrderRepository> {
  constructor() {
    super(orderRepository);
  }

  async paginate(params: QueryParams, extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">): Promise<PaginatedResult<Order>> {
      return super.paginate(params, {
        ...extraOptions,
        attributes: {exclude: [
          'source_payload'
        ]}
      })
  }

  async getFullOrder(id: string): Promise<FullOrder> {
    const orderData = await this.repository.findOne({
      where: { id },
      include: [
        {
          model: Customer,
          as: "customer",
        },
      ],
    });

    if (!orderData) throw new Error("Pedido não encontrado.");

    return orderData as unknown as Promise<FullOrder>;
  }

  async getFullOrdersByQuery(options: FindOptions): Promise<FullOrder[]> {
    const orderData = await this.repository.findAll(options);

    if (!orderData) throw new Error("Pedido não encontrado.");

    return orderData as unknown as Promise<FullOrder[]>;
  }

  async releaseWaitingAcceptanceForToday(): Promise<number> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setUTCHours(23, 59, 59, 999);

    const [affectedCount] = await this.repository.bulkUpdate(
      {
        waiting_acceptance: false,
      },
      {
        where: {
          waiting_acceptance: true,
          internal_status: "WAITING FOR NFE EMISSION",
          collection_date: {
            [Op.between]: [startOfToday, endOfToday],
          },
          createdAt: {
            [Op.between]: [startOfToday, endOfToday],
          },
        },
      },
    );

    if (!affectedCount) {
      console.log(
        `[OrdersService] Nenhum pedido encontrado para liberar geração de nota fiscal.`,
      );
    }

    return affectedCount;
  }
}

export default new OrderService();
