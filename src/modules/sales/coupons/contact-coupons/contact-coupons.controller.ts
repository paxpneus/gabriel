import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { validateCreate, validateUpdate } from "../../../../middlewares/validation";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import ContactCoupon from "./contact-coupons.model";
import contactCouponService, { ContactCouponService } from "./contact-coupons.service";
import {
  CreateContactCouponSchema,
  UpdateContactCouponSchema,
} from "./schemas/contact-coupon.schema";

// Vínculos afiliado ↔ cupom; nunca apagados, só inativados/transferidos.
class ContactCouponController extends BaseController<ContactCoupon, ContactCouponService> {
  constructor() {
    super(contactCouponService);

    this.router.post("/transfer", ...this.mw("transfer"), this.transfer);
    this.router.patch("/:id/deactivate", ...this.mw("deactivate"), this.deactivate);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, validateCreate(CreateContactCouponSchema), userPermissions],
      update: [authenticate, validateUpdate(UpdateContactCouponSchema), userPermissions],
      transfer: [authenticate, validateCreate(CreateContactCouponSchema), userPermissions],
      deactivate: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }

  // Delete e bulk desativados: vínculo só é inativado.
  private notAllowed = async (_req: Request, res: Response): Promise<Response> =>
    res.status(405).json({ error: "Operação não permitida para cupons de afiliado" });

  destroy = this.notAllowed;
  bulkDestroy = this.notAllowed;
  bulkCreate = this.notAllowed;
  bulkUpdate = this.notAllowed;

  // POST /: vincula cupom a afiliado.
  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.link(req.body);
      return res.status(201).json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // PUT /:id: só a taxa de comissão.
  update = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.updateCommissionRate(
        req.params.id as string,
        req.body.commission_rate,
      );
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // POST /transfer: inativa o dono atual do cupom e vincula o novo.
  transfer = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.transfer(req.body);
      return res.status(201).json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // PATCH /:id/deactivate.
  deactivate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.deactivate(req.params.id as string);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new ContactCouponController();
