import BaseService from '../../../../shared/utils/base-models/base-service';
import Role from './role.model';
import roleRepository, { RoleRepository } from './role.repository';

export class RoleService extends BaseService<Role, RoleRepository> {
  constructor() {
    super(roleRepository);
  }
}

export default new RoleService();
