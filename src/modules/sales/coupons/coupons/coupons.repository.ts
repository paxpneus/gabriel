import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import Coupon from "./coupons.model";

export class CouponRepository extends BaseRepository<Coupon> {
  constructor() {
    super(Coupon);
  }
}

export default new CouponRepository();
