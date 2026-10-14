import { Transaction, UniqueConstraintError } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { CreateContactCouponInput } from "./schemas/contact-coupon.schema";
import contactService from "../../contacts/contacts.service";
import { AFFILIATED_CONTACT_TYPE } from "../../contacts/contacts.types";
import couponService from "../coupons/coupons.service";
import ContactCoupon from "./contact-coupons.model";
import contactCouponRepository, { ContactCouponRepository } from "./contact-coupons.repository";

export class ContactCouponService extends BaseService<ContactCoupon, ContactCouponRepository> {
  constructor() {
    super(contactCouponRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      filterableFields: ["contact_id", "coupon_id", "active"],
      sortableFields: ["createdAt"],
    };
  }

  private async assertAffiliated(contactId: string, transaction?: Transaction) {
    const contact = await contactService.findOne({
      where: { id: contactId, type: AFFILIATED_CONTACT_TYPE },
      attributes: ["id"],
      transaction,
    });
    if (!contact) throw new Error("Somente contatos do tipo afiliado podem ter cupom vinculado");
  }

  private async assertCouponExists(couponId: string, transaction?: Transaction) {
    const coupon = await couponService.findById(couponId, { attributes: ["id"], transaction });
    if (!coupon) throw new Error("Cupom não encontrado");
  }

  /** Um afiliado pode ter vários cupons; um cupom só tem um dono ativo. */
  async link(dto: CreateContactCouponInput, transaction?: Transaction): Promise<ContactCoupon> {
    await this.assertAffiliated(dto.contact_id, transaction);
    await this.assertCouponExists(dto.coupon_id, transaction);

    const currentOwner = await this.repository.findActiveByCoupon(dto.coupon_id, transaction);
    if (currentOwner) {
      throw new Error("Este cupom já tem um afiliado ativo. Use a transferência para trocar o dono.");
    }

    try {
      return await this.repository.create(
        { contact_id: dto.contact_id, coupon_id: dto.coupon_id, commission_rate: dto.commission_rate },
        { transaction },
      );
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw new Error("Este cupom já tem um afiliado ativo. Use a transferência para trocar o dono.");
      }
      throw err;
    }
  }

  async deactivate(id: string, transaction?: Transaction): Promise<ContactCoupon | null> {
    return this.repository.update(id, { active: false, deactivated_at: new Date() }, { transaction });
  }

  /** Inativa o dono atual (se houver) e cria o vínculo novo, numa transação. */
  async transfer(dto: CreateContactCouponInput): Promise<ContactCoupon> {
    return sequelize.transaction(async (t) => {
      const currentOwner = await this.repository.findActiveByCoupon(dto.coupon_id, t);
      if (currentOwner) await this.deactivate(currentOwner.id, t);
      return this.link(dto, t);
    });
  }

  /** Taxa nova só vale pros próximos pedidos — order_coupons guarda a taxa da época. */
  async updateCommissionRate(id: string, commissionRate: number): Promise<ContactCoupon | null> {
    return this.repository.update(id, { commission_rate: commissionRate });
  }

  findOwnerAt(couponId: string, date: Date, transaction?: Transaction) {
    return this.repository.findOwnerAt(couponId, date, transaction);
  }
}

export default new ContactCouponService();
