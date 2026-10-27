import { Op, Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import ContactCoupon from "./contact-coupons.model";

const OWNER_ATTRIBUTES = ["id", "contact_id", "coupon_id", "commission_rate", "active"];

export class ContactCouponRepository extends BaseRepository<ContactCoupon> {
  constructor() {
    super(ContactCoupon);
  }

  // Dono ativo atual do cupom (no máximo um, pelo índice parcial).
  findActiveByCoupon(couponId: string, transaction?: Transaction) {
    return this.model.findOne({
      where: { coupon_id: couponId, active: true },
      attributes: OWNER_ATTRIBUTES,
      transaction,
    });
  }

  // Dono do cupom numa data: vínculo criado até ela e ainda não inativado nela.
  findOwnerAt(couponId: string, date: Date, transaction?: Transaction) {
    return this.model.findOne({
      where: {
        coupon_id: couponId,
        createdAt: { [Op.lte]: date },
        [Op.or]: [{ deactivated_at: null }, { deactivated_at: { [Op.gt]: date } }],
      },
      attributes: OWNER_ATTRIBUTES,
      order: [["createdAt", "DESC"]],
      transaction,
    });
  }
}

export default new ContactCouponRepository();
