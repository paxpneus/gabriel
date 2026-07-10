import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import Subgroup from "./subgroup.model";
import subgroupService from "./subgroup.service";

export class SubgroupController extends BaseController<
  Subgroup,
  typeof subgroupService
> {
  constructor() {
    super(subgroupService);

    this.router.get(
      "/with-group/get",
      ...this.mw("withGroup"),
      this.findAllWithGroup,
    );
    this.router.get(
      "/:id/group",
      ...this.mw("findByIdWithGroup"),
      this.findByIdWithGroup,
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
      withGroup: [authenticate, userPermissions],
      findByIdWithGroup: [authenticate, userPermissions],
    };
  }

  findByIdWithGroup = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const subgroup = await this.service.findByIdWithGroup(
        req.params.id as string,
      );

      if (!subgroup) {
        return res.status(404).json({ error: "Subgrupo não encontrado" });
      }

      return res.json(subgroup);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  findAllWithGroup = async (
    _req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const subgroups = await this.service.findAllWithGroup();
      return res.json(subgroups);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new SubgroupController();
