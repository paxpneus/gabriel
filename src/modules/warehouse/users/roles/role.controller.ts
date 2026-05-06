import { ROLE_PERMISSIONS } from '../../../../shared/constants/roles';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import Role from './role.model';
import RoleService from './role.service';
import { Request, Response } from "express";

export class RoleController extends BaseController<Role, typeof RoleService> {
  constructor() {
    super(RoleService);

    this.router.get("/entities/get", this.getBaseRoles)
  }

  async getBaseRoles(req: Request, res: Response,) {
    return res.status(200).json(ROLE_PERMISSIONS)
  }
}

export default new RoleController();
