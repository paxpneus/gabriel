import { FindAndCountOptions, FindOptions } from 'sequelize';
import BaseRepository from '../../../shared/utils/base-models/base-repository';
import { PaginatedResult, QueryConfig, QueryParams } from '../../../shared/query/query.types';
import UnitBusinessGroup from '../unit-business-groups/unit-business-group/unit-business-group.model';
import UnitBusinessConfig from './unit-business-config/unit-business-config.model';
import { UnitBusinessConfigAttributes } from './unit-business-config/unit-business-config.types';
import UnitBusiness from './unit-business.model';
import { UnitBusinessAttributes } from './unit-business.types';

export class UnitBusinessRepository extends BaseRepository<UnitBusiness> {
  constructor() {
    super(UnitBusiness);
  }

  async findByIdWithConfig(id: string): Promise<UnitBusinessAttributes> {
    const result = await this.findById(id, {
      include: [
        {
          model: UnitBusinessConfig,
          as: 'config',
        }
      ]
    })

    if (!result) throw new Error("Unit business não encontrado")
    
    return result
  }

  // distinct: o join N:N com grupos duplicaria linhas no count.
  findPaginatedWithGroups(
    params: QueryParams,
    config: QueryConfig,
    extraOptions: Omit<FindAndCountOptions, 'where' | 'limit' | 'offset' | 'order'> = {},
    forcedOrder?: FindOptions['order'],
  ): Promise<PaginatedResult<UnitBusiness>> {
    return this.findPaginated(params, config, {
      ...extraOptions,
      distinct: true,
      include: [
        ...((extraOptions.include as any[]) ?? []),
        {
          model: UnitBusinessGroup,
          as: 'groups',
          attributes: ['id', 'name'],
          through: { attributes: [] },
        },
      ],
    }, undefined, forcedOrder);
  }
}

export default new UnitBusinessRepository();
