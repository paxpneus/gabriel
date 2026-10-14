import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { validateCreate, validateUpdate } from "../../../../middlewares/validation";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import { CreateCouponSchema, UpdateCouponSchema } from "./schemas/coupon.schema";
import Coupon from "./coupons.model";
import couponService, { CouponService } from "./coupons.service";
import { bulkNotAllowed, deletionNotAllowed } from "../helpers/not-allowed-handlers";

class CouponController extends BaseController<Coupon, CouponService> {
  constructor() {
    super(couponService);

    this.router.patch(`/:id/deactivate`, ...this.mw("setActive"), this.setActive(false));
    this.router.patch(`/:id/activate`, ...this.mw("setActive"), this.setActive(true));
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, validateCreate(CreateCouponSchema), userPermissions],
      update: [authenticate, validateUpdate(UpdateCouponSchema), userPermissions],
      setActive: [authenticate, userPermissions],
    };
  }

  destroy = deletionNotAllowed;
  bulkDestroy = deletionNotAllowed;
  bulkCreate = bulkNotAllowed;
  bulkUpdate = bulkNotAllowed;

  private setActive = (active: boolean) => async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.setActive(String(req.params.id), active);
      if (!record) return res.status(404).json({ error: "Cupom não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new CouponController();
