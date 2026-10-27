import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { ORDER_DISCOUNT_TYPE_PERCENT } from "../../orders/order/helpers/discount";
import orderService from "../../orders/order/orders.service";
import contactCouponService from "../contact-coupons/contact-coupons.service";
import couponService from "../coupons/coupons.service";
import OrderCoupon from "./order-coupons.model";
import orderCouponRepository, { OrderCouponRepository } from "./order-coupons.repository";
import { RegisterOrderCouponDto } from "./order-coupons.types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export class OrderCouponService extends BaseService<OrderCoupon, OrderCouponRepository> {
  constructor() {
    super(orderCouponRepository);
  }

  // Grava o cupom do pedido do site congelando dono/taxa/comissão; idempotente (nunca recalcula).
  async registerFromMagento({
    orderId,
    couponCode,
    discountAmount,
  }: RegisterOrderCouponDto): Promise<OrderCoupon | null> {
    const order = await orderService.findById(orderId, {
      attributes: ["id", "date", "createdAt", "total_products", "discount_value", "discount_type"],
    });
    if (!order) throw new Error(`Order ${orderId} not found`);

    const created = await sequelize.transaction(async (t) => {
      const coupon = await couponService.findOrCreateByCode(couponCode, t);

      const existing = await this.repository.findByOrderAndCoupon(orderId, coupon.id, t);
      if (existing) return null;

      // orders.date só tem o dia: usa o createdAt, limitado ao fim do dia do pedido (ingestão atrasada).
      const createdAt = new Date(order.createdAt);
      const endOfOrderDay = order.date ? new Date(new Date(order.date).getTime() + ONE_DAY_MS) : null;
      const referenceDate = endOfOrderDay && endOfOrderDay < createdAt ? endOfOrderDay : createdAt;

      // Cupom inativo: grava só o desconto, sem afiliado/comissão.
      let owner = coupon.active
        ? await contactCouponService.findOwnerAt(coupon.id, referenceDate, t)
        : null;

      if (owner && (await this.repository.findAffiliatedByOrder(orderId, t))) {
        console.warn(
          `[ORDER_COUPON] order=${orderId} already has an affiliate; coupon ${coupon.code} saved without commission`,
        );
        owner = null;
      }

      // Base = produtos − desconto do pedido (mesma base da comissão do vendedor).
      const totalProducts = Number(order.total_products ?? 0);
      const discountValue = Number(order.discount_value ?? 0);
      const orderDiscount =
        order.discount_type === ORDER_DISCOUNT_TYPE_PERCENT
          ? Math.round(totalProducts * discountValue) / 100
          : discountValue;
      const commissionRate = owner ? Number(owner.commission_rate) : null;
      const commissionAmount =
        commissionRate !== null
          ? Math.round((totalProducts - orderDiscount) * commissionRate) / 100
          : null;

      return this.repository.create(
        {
          order_id: orderId,
          coupon_id: coupon.id,
          contact_coupon_id: owner?.id ?? null,
          discount_amount: discountAmount,
          commission_rate: commissionRate,
          commission_amount: commissionAmount,
        },
        { transaction: t },
      );
    });

    // Bumpa updated_at pros jobs incrementais dos relatórios reprocessarem o pedido.
    if (created) await orderService.touch(orderId);
    return created;
  }
}

export default new OrderCouponService();
