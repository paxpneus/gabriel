import { Op, Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import OrderCoupon from "./order-coupons.model";

export class OrderCouponRepository extends BaseRepository<OrderCoupon> {
  constructor() {
    super(OrderCoupon);
  }

  findByOrderAndCoupon(orderId: string, couponId: string, transaction?: Transaction) {
    return this.findOne({
      where: { order_id: orderId, coupon_id: couponId },
      attributes: ["order_id", "coupon_id"],
      transaction,
    });
  }

  findAffiliatedByOrder(orderId: string, transaction?: Transaction) {
    return this.findOne({
      where: { order_id: orderId, contact_coupon_id: { [Op.ne]: null } },
      attributes: ["order_id", "coupon_id", "contact_coupon_id"],
      transaction,
    });
  }
}

export default new OrderCouponRepository();
