import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import Group from "./group.model";
import groupService from "./group.service";

export class GroupController extends BaseController<
  Group,
  typeof groupService
> {
  constructor() {
    super(groupService);

    this.router.get(
      "/:id/subgroups",
      ...this.mw("findByIdWithSubgroups"),
      this.findByIdWithSubgroups,
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
      findByIdWithSubgroups: [authenticate, userPermissions],
    };
  }

  findByIdWithSubgroups = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const group = await this.service.findByIdWithSubgroups(
        req.params.id as string,
      );

      if (!group) {
        return res.status(404).json({ error: "Grupo não encontrado" });
      }

      return res.json(group);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  
}

export default new GroupController();
