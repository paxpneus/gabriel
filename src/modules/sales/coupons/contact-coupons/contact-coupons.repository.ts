import { Op, Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import { QueryConfig, QueryParams } from "../../../../shared/query/query.types";
import Coupon from "../coupons/coupons.model";
import ContactCoupon from "./contact-coupons.model";

const OWNER_ATTRIBUTES = ["id", "contact_id", "coupon_id", "commission_rate", "active"];

// Cupom do vínculo nas respostas da rota: só código e status (o front não cruza com /coupons).
const COUPON_INCLUDE = { model: Coupon, as: "coupon", attributes: ["code", "active"] };

export class ContactCouponRepository extends BaseRepository<ContactCoupon> {
  constructor() {
    super(ContactCoupon);
  }

  // Listagem paginada do index com `coupon: { code, active }` em cada vínculo.
  findPaginatedWithCoupon(params: QueryParams, config: QueryConfig) {
    return this.findPaginated(params, config, { include: [COUPON_INCLUDE] });
  }

  // Vínculo com `coupon: { code, active }`, como a rota devolve depois de cada escrita.
  findByIdWithCoupon(id: string, transaction?: Transaction) {
    return this.model.findByPk(id, { include: [COUPON_INCLUDE], transaction });
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
