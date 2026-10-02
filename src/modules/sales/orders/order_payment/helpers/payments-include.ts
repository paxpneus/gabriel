import { Includeable } from "sequelize";
import OrderPayment from "../order_payment.model";
import PaymentMethod from "../../payment_method/payment_method.model";

export const PAYMENTS_INCLUDE: Includeable = {
  model: OrderPayment,
  as: "payments",
  attributes: ["id", "amount", "due_date"],
  include: [
    {
      model: PaymentMethod,
      as: "paymentMethod",
      attributes: ["id", "description"],
    },
  ],
};
