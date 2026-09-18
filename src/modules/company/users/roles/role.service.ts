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

  /**
   * Role administradora do sistema. Fonte única do nome "Administrador" —
   * qualquer checagem de admin deve comparar contra o id retornado aqui,
   * nunca contra o literal.
   */
  async getAdminRole(): Promise<Role | null> {
    return this.findOne({ where: { name: "Administrador" } });
  }

  async isAdminRole(roleId: string): Promise<boolean> {
    const adminRole = await this.getAdminRole();
    return !!adminRole && adminRole.id === roleId;
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
