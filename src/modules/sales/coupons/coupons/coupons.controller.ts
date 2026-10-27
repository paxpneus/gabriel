import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { validateCreate, validateUpdate } from "../../../../middlewares/validation";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import Coupon from "./coupons.model";
import couponService, { CouponService } from "./coupons.service";
import { CreateCouponSchema, UpdateCouponSchema } from "./schemas/coupon.schema";

// CRUD de cupons; nada é apagado (histórico de pedidos), só ativado/inativado.
class CouponController extends BaseController<Coupon, CouponService> {
  constructor() {
    super(couponService);

    this.router.patch("/:id/deactivate", ...this.mw("setActive"), (req, res) =>
      this.setActive(req, res, false),
    );
    this.router.patch("/:id/activate", ...this.mw("setActive"), (req, res) =>
      this.setActive(req, res, true),
    );
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, validateCreate(CreateCouponSchema), userPermissions],
      update: [authenticate, validateUpdate(UpdateCouponSchema), userPermissions],
      setActive: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }

  // Delete e bulk desativados: cupom só é inativado.
  private notAllowed = async (_req: Request, res: Response): Promise<Response> =>
    res.status(405).json({ error: "Operação não permitida para cupons" });

  destroy = this.notAllowed;
  bulkDestroy = this.notAllowed;
  bulkCreate = this.notAllowed;
  bulkUpdate = this.notAllowed;

  // PATCH /:id/activate e /:id/deactivate.
  setActive = async (req: Request, res: Response, active: boolean): Promise<Response> => {
    try {
      const record = await this.service.setActive(req.params.id as string, active);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new CouponController();
