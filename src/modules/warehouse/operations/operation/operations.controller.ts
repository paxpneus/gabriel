import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import Operations from "./operations.model";
import OperationsService from "./operations.service";
import User from "../../users/users/user.model";

export class OperationsController extends BaseController<
  Operations,
  typeof OperationsService
> {
  constructor() {
    super(OperationsService);
    this.router.get("/full/:id", ...this.mw("show"), (req, res) =>
      this.showFull(req, res),
    );

    this.router.put(
      "/confirm-received/:id",
      ...this.mw("markAsReceived"),
      (req, res) => this.markAsReceived(req, res),
    );
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      markAsReceived: [authenticate, userPermissions],
    };
  }

 showFull = async (req: Request, res: Response): Promise<Response> => {
  try {
    const userId = (req as any).user?.id;
    const user = await User.findByPk(userId, { attributes: ['unit_business_id'] });
    const unitBusinessId = user?.unit_business_id;

    const record = await this.service.findByIdFull(req.params.id as string, unitBusinessId);
    if (!record) return res.status(404).json({ error: "Não encontrado" });
    return res.json(record);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

  markAsReceived = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id, userId } = req.params;
      await this.service.markAsReceived(id as string, userId as string);
      return res.status(200).json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new OperationsController();
