import { CreateOptions, Transaction, UniqueConstraintError, UpdateOptions } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Coupon from "./coupons.model";
import couponRepository, { CouponRepository } from "./coupons.repository";
import { CouponCreationAttributes } from "./coupons.types";
import { normalizeCouponCode } from "./helpers/normalize-coupon-code";

export class CouponService extends BaseService<Coupon, CouponRepository> {
  constructor() {
    super(couponRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["code"],
      filterableFields: ["active", "discount_type"],
      sortableFields: ["code", "createdAt"],
    };
  }

  async create(data: Partial<CouponCreationAttributes>, options?: CreateOptions) {
    try {
      return await super.create(
        { ...data, ...(data.code ? { code: normalizeCouponCode(data.code) } : {}) },
        options,
      );
    } catch (err) {
      throw this.translateUniqueError(err);
    }
  }

  async update(id: string, data: Partial<CouponCreationAttributes>, options?: Partial<UpdateOptions>) {
    try {
      return await super.update(
        id,
        { ...data, ...(data.code ? { code: normalizeCouponCode(data.code) } : {}) },
        options,
      );
    } catch (err) {
      throw this.translateUniqueError(err);
    }
  }

  /** Cupom vindo de pedido (Magento) que ainda não foi cadastrado nasce ativo e sem desconto definido. */
  async findOrCreateByCode(code: string, transaction?: Transaction): Promise<Coupon> {
    const normalized = normalizeCouponCode(code);
    const existing = await this.repository.findOne({
      where: { code: normalized },
      attributes: ["id", "code", "active"],
      transaction,
    });
    if (existing) return existing;

    return this.repository.create({ code: normalized }, { transaction });
  }

  async setActive(id: string, active: boolean): Promise<Coupon | null> {
    return this.repository.update(id, { active });
  }

  private translateUniqueError(err: unknown): unknown {
    if (err instanceof UniqueConstraintError) return new Error("Já existe um cupom com este código");
    return err;
  }
}

export default new CouponService();
