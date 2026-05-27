import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import Operations from "./operations.model";
import OperationsService from "./operations.service";

export class OperationsController extends BaseController<
  Operations,
  typeof OperationsService
> {
  constructor() {
    super(OperationsService);
    this.router.get("/full/:id", ...this.mw("show"), (req, res) =>
      this.showFull(req, res),
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
    };
  }

  showFull = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.findByIdFull(req.params.id as string);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new OperationsController();
