import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import UnitBusinessConfig from "./unit-business-config.model";
import UnitBusinessConfigService from "./unit-business-config.service";

export class UnitBusinessConfigController extends BaseController<
  UnitBusinessConfig,
  typeof UnitBusinessConfigService
> {
  constructor() {
    super(UnitBusinessConfigService);

    this.router.get(
      "/by-unit-business/:unitBusinessId",
      ...this.mw("byUnitBusiness"),
      (req, res) => this.byUnitBusiness(req, res),
    );
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
      byUnitBusiness: [authenticate, userPermissions],
    };
  }

  byUnitBusiness = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const record = await this.service.findByUnitBusinessId(
        String(req.params.unitBusinessId),
      );

      if (!record) {
        return res.status(404).json({ error: "Configuração não encontrada" });
      }

      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new UnitBusinessConfigController();
