import { CreateOptions, Transaction, UniqueConstraintError, UpdateOptions } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Coupon from "./coupons.model";
import couponRepository, { CouponRepository } from "./coupons.repository";

export class CouponService extends BaseService<Coupon, CouponRepository> {
  constructor() {
    super(couponRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      searchFields: ["code"],
      filterableFields: ["active"],
    };
  }

  // Código comparado sem diferenciar caixa/espaços (Magento manda como o cliente digitou).
  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  // Normaliza o código; UNIQUE em coupons.code vira mensagem de UI.
  async create(data: Partial<Coupon["_creationAttributes"]>, options?: CreateOptions) {
    const payload = data.code ? { ...data, code: this.normalizeCode(data.code) } : data;
    try {
      return await super.create(payload, options);
    } catch (err) {
      if (err instanceof UniqueConstraintError) throw new Error("Já existe um cupom com este código");
      throw err;
    }
  }

  // Mesma normalização/erro do create.
  async update(
    id: string,
    data: Partial<Coupon["_creationAttributes"]>,
    options?: Partial<UpdateOptions>,
  ) {
    const payload = data.code ? { ...data, code: this.normalizeCode(data.code) } : data;
    try {
      return await super.update(id, payload, options);
    } catch (err) {
      if (err instanceof UniqueConstraintError) throw new Error("Já existe um cupom com este código");
      throw err;
    }
  }

  // Usado na ingestão da Magento: cupom desconhecido nasce ativo e sem desconto definido.
  async findOrCreateByCode(code: string, transaction?: Transaction): Promise<Coupon> {
    const normalized = this.normalizeCode(code);
    const existing = await this.repository.findOne({
      where: { code: normalized },
      attributes: ["id", "code", "active"],
      transaction,
    });
    if (existing) return existing;

    return this.repository.create({ code: normalized }, { transaction });
  }

  // Ativa/inativa sem apagar: histórico de order_coupons continua apontando pro cupom.
  setActive(id: string, active: boolean) {
    return this.repository.update(id, { active });
  }
}

export default new CouponService();
