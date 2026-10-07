import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import UnitBusinessGroup from "./unit-business-group.model";
import UnitBusinessGroupService from "./unit-business-group.service";

export class UnitBusinessGroupController extends BaseController<
  UnitBusinessGroup,
  typeof UnitBusinessGroupService
> {
  constructor() {
    super(UnitBusinessGroupService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
    };
  }

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.getFullById(String(req.params.id));
      if (!record) return res.status(404).json({ error: "Grupo não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new UnitBusinessGroupController();
