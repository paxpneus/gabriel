import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { ROLE_PERMISSIONS } from "../../../../shared/constants/roles";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import UserConfig from "./user_config.model";
import UserConfigService from "./user_config.service";
import { Request, Response } from "express";

export class UserConfigController extends BaseController<
  UserConfig,
  typeof UserConfigService
> {
  constructor() {
    super(UserConfigService);

    this.router.get("/user-types/get", this.getUserTypes)
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      getUserTypes: [authenticate, userPermissions]
    };
  }

  async getUserTypes(req: Request, res: Response,) {
    return res.status(200).json(ROLE_PERMISSIONS)
  }
}

export default new UserConfigController();
