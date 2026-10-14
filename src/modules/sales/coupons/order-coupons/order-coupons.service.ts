import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import orderService from "../../orders/order/orders.service";
import { orderNetProductsAmount } from "../../orders/order/helpers/discount";
import contactCouponService from "../contact-coupons/contact-coupons.service";
import couponService from "../coupons/coupons.service";
import { couponOwnerReferenceDate } from "./helpers/owner-reference-date";
import OrderCoupon from "./order-coupons.model";
import orderCouponRepository, { OrderCouponRepository } from "./order-coupons.repository";
import { RegisterOrderCouponInput } from "./order-coupons.types";

export class OrderCouponService extends BaseService<OrderCoupon, OrderCouponRepository> {
  constructor() {
    super(orderCouponRepository);
  }

  // Grava uma única vez (nunca recalcula). Comissão só com cupom ativo, dono vigente na venda
  // e pedido ainda sem afiliado.
  async registerFromMagento({ orderId, couponCode, discountAmount }: RegisterOrderCouponInput): Promise<void> {
    const order = await orderService.findById(orderId, {
      attributes: ["id", "date", "createdAt", "total_products", "discount_value", "discount_type"],
    });
    if (!order) throw new Error(`Order ${orderId} not found`);

    await sequelize.transaction(async (t) => {
      const coupon = await couponService.findOrCreateByCode(couponCode, t);
      if (await this.repository.findByOrderAndCoupon(orderId, coupon.id, t)) return;

      const owner = coupon.active
        ? await contactCouponService.findOwnerAt(coupon.id, couponOwnerReferenceDate(order), t)
        : null;

      const existingAffiliate = owner ? await this.repository.findAffiliatedByOrder(orderId, t) : null;
      if (existingAffiliate) {
        console.warn(
          `[OrderCouponService] Order ${orderId} already has an affiliate coupon (${existingAffiliate.coupon_id}); coupon ${coupon.code} recorded without commission.`,
        );
      }
      const affiliate = existingAffiliate ? null : owner;

      const commissionRate = affiliate ? Number(affiliate.commission_rate) : null;
      const commissionAmount =
        commissionRate !== null
          ? Math.round(orderNetProductsAmount(order) * commissionRate) / 100
          : null;

      await this.repository.create(
        {
          order_id: orderId,
          coupon_id: coupon.id,
          contact_coupon_id: affiliate?.id ?? null,
          discount_amount: discountAmount,
          commission_rate: commissionRate,
          commission_amount: commissionAmount,
        },
        { transaction: t },
      );
    });

    // Bump de updated_at: o job incremental dos relatórios reprocessa o pedido com a comissão nova.
    await orderService.touch(orderId);
  }
}

export default new OrderCouponService();
