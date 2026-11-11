import { Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import Coupon from "./coupons.model";

export class CouponRepository extends BaseRepository<Coupon> {
  constructor() {
    super(Coupon);
  }

  // findOrCreate do Sequelize usa savepoint: dois jobs criando o mesmo código novo não derrubam a transação (UNIQUE).
  async findOrCreateByCode(code: string, transaction?: Transaction): Promise<Coupon> {
    const [coupon] = await this.model.findOrCreate({
      where: { code },
      defaults: { code },
      transaction,
    });
    return coupon;
  }
}

export default new CouponRepository();
