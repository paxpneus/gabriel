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

  // Grava o cupom do pedido do site congelando dono e taxa; idempotente (linha existente não é refeita).
  async registerFromMagento({
    orderId,
    couponCode,
    discountAmount,
    orderedAt,
  }: RegisterOrderCouponDto): Promise<OrderCoupon | null> {
    const order = await orderService.findById(orderId, {
      attributes: ["id", "date", "createdAt", "total_products", "discount_value", "discount_type"],
    });
    if (!order) throw new Error(`Order ${orderId} not found`);

    const created = await sequelize.transaction(async (t) => {
      const coupon = await couponService.findOrCreateByCode(couponCode, t);

      const existing = await this.repository.findByOrderAndCoupon(orderId, coupon.id, t);
      if (existing) return null;

      // Hora da venda na Magento; sem ela, createdAt do pedido limitado ao fim do dia (orders.date só tem o dia).
      let referenceDate = orderedAt;
      if (!referenceDate) {
        const createdAt = new Date(order.createdAt);
        const endOfOrderDay = order.date ? new Date(new Date(order.date).getTime() + ONE_DAY_MS) : null;
        referenceDate = endOfOrderDay && endOfOrderDay < createdAt ? endOfOrderDay : createdAt;
      }

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

      const commissionRate = owner ? Number(owner.commission_rate) : null;
      let commissionAmount = null;
      if (commissionRate !== null) commissionAmount = this.commissionAmount(order, commissionRate);

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

  // Pedido editado na Bling: refaz o valor da comissão com o total atual, mantendo dono e taxa congelados.
  async syncCommissionWithOrder(orderId: string): Promise<void> {
    const affiliated = await this.repository.findAffiliatedByOrder(orderId);
    if (!affiliated || affiliated.commission_rate == null) return;

    const order = await orderService.findById(orderId, {
      attributes: ["id", "total_products", "discount_value", "discount_type"],
    });
    if (!order) return;

    const amount = this.commissionAmount(order, Number(affiliated.commission_rate));
    if (amount === Number(affiliated.commission_amount)) return;
    await this.repository.updateCommissionAmount(orderId, affiliated.coupon_id, amount);
  }

  // Base = produtos − desconto do pedido (mesma base da comissão do vendedor); em centavos inteiros pra arredondar como o SQL.
  private commissionAmount(
    order: { total_products?: number | string | null; discount_value?: number | string | null; discount_type?: string | null },
    commissionRate: number,
  ): number {
    const totalCents = Math.round(Number(order.total_products ?? 0) * 100);
    const discountValue = Number(order.discount_value ?? 0);
    // % com 2 casas vira inteiro (×100): produto de inteiros é exato, só a divisão final arredonda.
    let discountCents = Math.round(discountValue * 100);
    if (order.discount_type === ORDER_DISCOUNT_TYPE_PERCENT) {
      discountCents = Math.round((totalCents * Math.round(discountValue * 100)) / 10000);
    }
    return Math.round(((totalCents - discountCents) * Math.round(commissionRate * 100)) / 10000) / 100;
  }
}

export default new OrderCouponService();
