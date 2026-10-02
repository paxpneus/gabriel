import BaseService from "../../../../shared/utils/base-models/base-service";
import OrderPayment from "./order_payment.model";
import orderPaymentRepository, {
  OrderPaymentRepository,
} from "./order_payment.repository";
import { OrderPaymentCreationAttributes } from "./order_payment.types";

export class OrderPaymentService extends BaseService<
  OrderPayment,
  OrderPaymentRepository
> {
  constructor() {
    super(orderPaymentRepository);
  }

  replaceForOrder(orderId: string, payments: OrderPaymentCreationAttributes[]) {
    return this.repository.replaceForOrder(orderId, payments);
  }
}

export default new OrderPaymentService();
