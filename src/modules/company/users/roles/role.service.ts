import { UpdateOptions } from 'sequelize';
import BaseService from '../../../../shared/utils/base-models/base-service';
import Role from './role.model';
import roleRepository, { RoleRepository } from './role.repository';
import { RoleCreationAttributes } from './role.types';
import redisService from '../../../../shared/utils/base-models/base-redis';

export class RoleService extends BaseService<Role, RoleRepository> {
  constructor() {
    super(roleRepository);
  }

   async update(
      id: string,
      data: Partial<RoleCreationAttributes>,
      options?: Partial<UpdateOptions>,
    ) {
      await redisService.deleteByPattern('user:*')
      return this.repository.update(id, data, options);
    }
}

export default new RoleService();
