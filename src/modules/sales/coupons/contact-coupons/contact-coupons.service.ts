import { Transaction, UniqueConstraintError } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { QueryParams } from "../../../../shared/query/query.types";
import { contactService } from "../../contacts";
import { AFFILIATED_CONTACT_TYPE } from "../../contacts/contacts.types";
import couponService from "../coupons/coupons.service";
import ContactCoupon from "./contact-coupons.model";
import contactCouponRepository, {
  ContactCouponRepository,
} from "./contact-coupons.repository";
import { LinkContactCouponDto } from "./contact-coupons.types";

const ACTIVE_OWNER_ERROR =
  "Este cupom já tem um afiliado ativo. Use a transferência para trocar o dono.";

export class ContactCouponService extends BaseService<ContactCoupon, ContactCouponRepository> {
  constructor() {
    super(contactCouponRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      filterableFields: ["contact_id", "coupon_id", "active"],
    };
  }

  // Index com `coupon: { code, active }` em cada vínculo.
  paginate(params: QueryParams) {
    return this.repository.findPaginatedWithCoupon(params, this.queryConfig);
  }

  // Show com `coupon: { code, active }`.
  findById(id: string) {
    return this.repository.findByIdWithCoupon(id);
  }

  // POST /: vincula cupom a um afiliado; recusa se o cupom já tem dono ativo (troca é via transfer).
  async link(dto: LinkContactCouponDto) {
    const created = await this.createLink(dto);
    return this.repository.findByIdWithCoupon(created.id);
  }

  // PATCH /:id/deactivate; null = não existe.
  async deactivate(id: string) {
    const record = await this.closeLink(id);
    if (!record) return null;
    return this.repository.findByIdWithCoupon(id);
  }

  // Troca o dono do cupom: inativa o atual e vincula o novo, na mesma transação.
  transfer(dto: LinkContactCouponDto) {
    return sequelize.transaction(async (t) => {
      const currentOwner = await this.repository.findActiveByCoupon(dto.coupon_id, t);
      if (currentOwner) await this.closeLink(currentOwner.id, t);
      const created = await this.createLink(dto, t);
      return this.repository.findByIdWithCoupon(created.id, t);
    });
  }

  // Taxa nova só vale pros próximos pedidos: order_coupons já guarda a comissão congelada.
  async updateCommissionRate(id: string, commissionRate: number) {
    const updated = await this.repository.update(id, { commission_rate: commissionRate });
    if (!updated) return null;
    return this.repository.findByIdWithCoupon(id);
  }

  // Cria o vínculo validando afiliado, cupom e dono ativo único (usado pelo link e pelo transfer).
  private async createLink(dto: LinkContactCouponDto, transaction?: Transaction): Promise<ContactCoupon> {
    const affiliate = await contactService.findOne({
      where: { id: dto.contact_id, type: AFFILIATED_CONTACT_TYPE },
      attributes: ["id"],
      transaction,
    });
    if (!affiliate) {
      throw new Error("Somente contatos do tipo afiliado podem ter cupom vinculado");
    }

    const coupon = await couponService.findById(dto.coupon_id, {
      attributes: ["id"],
      transaction,
    });
    if (!coupon) throw new Error("Cupom não encontrado");

    const currentOwner = await this.repository.findActiveByCoupon(dto.coupon_id, transaction);
    if (currentOwner) throw new Error(ACTIVE_OWNER_ERROR);

    try {
      return await this.repository.create(
        {
          contact_id: dto.contact_id,
          coupon_id: dto.coupon_id,
          commission_rate: dto.commission_rate,
        },
        { transaction },
      );
    } catch (err) {
      // Corrida com outro link no mesmo cupom: índice parcial (coupon_id) WHERE active.
      if (err instanceof UniqueConstraintError) throw new Error(ACTIVE_OWNER_ERROR);
      throw err;
    }
  }

  // Inativa o vínculo; deactivated_at fecha a janela usada pelo findOwnerAt (só grava uma vez).
  private async closeLink(id: string, transaction?: Transaction): Promise<ContactCoupon | null> {
    const record = await this.repository.findById(id, {
      attributes: ["id", "active"],
      transaction,
    });
    if (!record || !record.active) return record;

    return this.repository.update(
      id,
      { active: false, deactivated_at: new Date() },
      { transaction },
    );
  }

  // Dono do cupom na data de referência do pedido (inclusive vínculos hoje inativos).
  findOwnerAt(couponId: string, date: Date, transaction?: Transaction) {
    return this.repository.findOwnerAt(couponId, date, transaction);
  }
}

export default new ContactCouponService();
