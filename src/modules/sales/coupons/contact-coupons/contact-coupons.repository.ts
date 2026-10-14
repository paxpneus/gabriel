import { Op, Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import ContactCoupon from "./contact-coupons.model";

const OWNER_ATTRIBUTES = ["id", "contact_id", "coupon_id", "commission_rate", "active"];

export class ContactCouponRepository extends BaseRepository<ContactCoupon> {
  constructor() {
    super(ContactCoupon);
  }

  findActiveByCoupon(couponId: string, transaction?: Transaction) {
    return this.findOne({
      where: { coupon_id: couponId, active: true },
      attributes: OWNER_ATTRIBUTES,
      transaction,
    });
  }

  /** Vínculo vigente na data (criado antes e não inativado até ela) — atraso de ingestão não troca o dono. */
  findOwnerAt(couponId: string, date: Date, transaction?: Transaction) {
    return this.findOne({
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
