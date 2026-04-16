import BaseController from '../../../../shared/utils/base-models/base-controller';
import Role from './role.model';
import RoleService from './role.service';

export class RoleController extends BaseController<Role, typeof RoleService> {
  constructor() {
    super(RoleService);
  }
}

export default new RoleController();
