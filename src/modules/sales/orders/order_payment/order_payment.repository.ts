import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import sequelize from "../../../../config/sequelize";
import OrderPayment from "./order_payment.model";
import { OrderPaymentCreationAttributes } from "./order_payment.types";

export class OrderPaymentRepository extends BaseRepository<OrderPayment> {
  constructor() {
    super(OrderPayment);
  }

  // Bling reedita/renumera as parcelas a cada update do pedido — substitui o
  // conjunto inteiro em vez de tentar casar por id_system.
  async replaceForOrder(
    orderId: string,
    payments: OrderPaymentCreationAttributes[],
  ): Promise<OrderPayment[]> {
    return sequelize.transaction(async (transaction) => {
      await this.model.destroy({ where: { order_id: orderId }, transaction });
      return this.model.bulkCreate(payments, { transaction });
    });
  }
}

export default new OrderPaymentRepository();
