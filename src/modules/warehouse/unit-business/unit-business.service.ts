import { FindOptions } from 'sequelize';
import { QueryParams, PaginatedResult } from '../../../shared/query/query.types';
import BaseService from '../../../shared/utils/base-models/base-service';
import UnitBusiness from './unit-business.model';
import unitBusinessRepository, { UnitBusinessRepository } from './unit-business.repository';
import { UnitBusinessAttributes } from './unit-business.types';
import { resolveAllowedUnitBusinessIds } from '../../../shared/utils/entities/users/resolve-user-unit-business';
import redisService from '../../../shared/utils/base-models/base-redis';
import User from '../users/users/user.model';
import { UserAttributes } from '../users/users/user.types';
import Role from '../users/roles/role.model';

export class UnitBusinessService extends BaseService<UnitBusiness, UnitBusinessRepository> {
  constructor() {
    super(unitBusinessRepository);

       this.queryConfig = {
      filterableFields: ['id', 'head_office'], 
      sortableFields: ['name', 'number', 'createdAt'],
      searchFields: ['name', 'cnpj'],
      defaults: {
        perPage: 20,
        sortBy: 'name',
        sortDir: 'ASC',
      },
    };
  }

  async getHeadOffice(): Promise<UnitBusinessAttributes> {
    const headOffice = await this.repository.findOne({
      where: {head_office: true}
    })

    if (!headOffice) {
      throw Error('Matriz não cadastrada')
    }

    return headOffice
  }

  async paginate(
  params: QueryParams,
  extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">
): Promise<PaginatedResult<UnitBusiness>> {

  let user: UserAttributes | null = await redisService.get(`user:${params.userId}`)
  if (!user) {
    user = await User.findByPk(params.userId, {
      include: [{ model: Role, as: 'role' }]
    })
  }

  const allowedIds = await resolveAllowedUnitBusinessIds(
    params.userId,
    params.filters?.unit_business_id
  );

  const canViewAll = user?.role?.permissions.find(s => s.entity === 'visualize-all-unit-business')

  const { userId, ...safeParams } = params;

  const finalParams: QueryParams = (allowedIds && !canViewAll)
    ? { ...safeParams, filters: { ...safeParams.filters, id: allowedIds } }
    : safeParams;

  return this.repository.findPaginated(finalParams, this.queryConfig, extraOptions);
}
}

export default new UnitBusinessService();
