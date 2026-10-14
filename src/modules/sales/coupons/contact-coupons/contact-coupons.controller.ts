import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { validateCreate, validateUpdate } from "../../../../middlewares/validation";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import {
  CreateContactCouponSchema,
  UpdateContactCouponSchema,
} from "./schemas/contact-coupon.schema";
import { bulkNotAllowed, deletionNotAllowed } from "../helpers/not-allowed-handlers";
import ContactCoupon from "./contact-coupons.model";
import contactCouponService, { ContactCouponService } from "./contact-coupons.service";

class ContactCouponController extends BaseController<ContactCoupon, ContactCouponService> {
  constructor() {
    super(contactCouponService);

    this.router.post(`/transfer`, ...this.mw("transfer"), this.transfer);
    this.router.patch(`/:id/deactivate`, ...this.mw("deactivate"), this.deactivate);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, validateCreate(CreateContactCouponSchema), userPermissions],
      update: [authenticate, validateUpdate(UpdateContactCouponSchema), userPermissions],
      transfer: [authenticate, validateCreate(CreateContactCouponSchema), userPermissions],
      deactivate: [authenticate, userPermissions],
    };
  }

  destroy = deletionNotAllowed;
  bulkDestroy = deletionNotAllowed;
  bulkCreate = bulkNotAllowed;
  bulkUpdate = bulkNotAllowed;

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      return res.status(201).json(await this.service.link(req.body));
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.updateCommissionRate(
        String(req.params.id),
        req.body.commission_rate,
      );
      if (!record) return res.status(404).json({ error: "Vínculo não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  transfer = async (req: Request, res: Response): Promise<Response> => {
    try {
      return res.status(201).json(await this.service.transfer(req.body));
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  deactivate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.deactivate(String(req.params.id));
      if (!record) return res.status(404).json({ error: "Vínculo não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new ContactCouponController();
