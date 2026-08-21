import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import Order from "./orders.model";
import Customer from "../../customers/customers.model";
import SalesOrderSnapshot from "../../../reports/daily-sales/sales-order-snapshot/sales-order-snapshot.model";
import SalesOrderItemSnapshot from "../../../reports/daily-sales/sales-order-item-snapshot/sales-order-item-snapshot.model";
import { OrderWithSalesSnapshotRaw } from "./orders.types";

export class OrderRepository extends BaseRepository<Order> {
  constructor() {
    super(Order);
  }

  async findWithSalesReportSnapshot(
    orderId: string,
  ): Promise<OrderWithSalesSnapshotRaw | null> {
    const data = await this.model.findOne({
      where: { id: orderId },
      include: [
        { model: Customer, as: "customer" },
        {
          model: SalesOrderSnapshot,
          as: "salesSnapshot",
          include: [{ model: SalesOrderItemSnapshot, as: "items" }],
        },
      ],
    });

    if (!data) return null;

    return data.get({ plain: true }) as unknown as OrderWithSalesSnapshotRaw;
  }
}

export default new OrderRepository();
