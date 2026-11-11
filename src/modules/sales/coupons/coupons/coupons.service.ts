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
    this.assertPercentDiscount(payload.discount_type, payload.discount_value);
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
    // Update parcial: completa tipo/valor com o que já está gravado antes de validar o teto do percentual.
    if ("discount_type" in payload || "discount_value" in payload) {
      const current = await this.repository.findById(id, { attributes: ["discount_type", "discount_value"] });
      this.assertPercentDiscount(
        "discount_type" in payload ? payload.discount_type : current?.discount_type,
        "discount_value" in payload ? payload.discount_value : current?.discount_value,
      );
    }
    try {
      return await super.update(id, payload, options);
    } catch (err) {
      if (err instanceof UniqueConstraintError) throw new Error("Já existe um cupom com este código");
      throw err;
    }
  }

  // Desconto percentual acima de 100% não existe.
  private assertPercentDiscount(type?: string | null, value?: number | null) {
    if (type === "percent" && Number(value ?? 0) > 100) {
      throw new Error("Desconto percentual não pode passar de 100");
    }
  }

  // Usado na ingestão da Magento: cupom desconhecido nasce ativo e sem desconto definido.
  async findOrCreateByCode(code: string, transaction?: Transaction): Promise<Coupon> {
    return this.repository.findOrCreateByCode(this.normalizeCode(code), transaction);
  }

  // Ativa/inativa sem apagar: histórico de order_coupons continua apontando pro cupom.
  setActive(id: string, active: boolean) {
    return this.repository.update(id, { active });
  }
}

export default new CouponService();
