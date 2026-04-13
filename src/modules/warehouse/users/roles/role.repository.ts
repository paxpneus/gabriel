import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import Role from './role.model';

export class RoleRepository extends BaseRepository<Role> {
  constructor() {
    super(Role);
  }
}

export default new RoleRepository();
