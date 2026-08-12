import { FindOptions, Op } from 'sequelize';
import { QueryParams, PaginatedResult } from '../../../shared/query/query.types';
import BaseService from '../../../shared/utils/base-models/base-service';
import sequelize from '../../../config/sequelize';
import UnitBusiness from './unit-business.model';
import unitBusinessRepository, { UnitBusinessRepository } from './unit-business.repository';
import { UnitBusinessAttributes } from './unit-business.types';
import UnitBusinessConfig from './unit-business-config/unit-business-config.model';
import { resolveAllowedUnitBusinessIds } from '../../../shared/utils/entities/users/resolve-user-unit-business';
import redisService from '../../../shared/utils/base-models/base-redis';
import User from '../users/users/user.model';
import { UserAttributes } from '../users/users/user.types';
import Role from '../users/roles/role.model';

export class UnitBusinessService extends BaseService<UnitBusiness, UnitBusinessRepository> {
  constructor() {
    super(unitBusinessRepository);

    this.queryConfig = {
      filterableFields: ['id', 'head_office', 'type'],
      sortableFields: ['name', 'number', 'createdAt', 'type'],
      searchFields: ['name', 'cnpj'],
      defaults: {
        perPage: 20,
        sortBy: 'name',
        sortDir: 'ASC',
      },
    };
  }

  async findByIdWithConfig(id: string): Promise<UnitBusinessAttributes> {
      const result = await this.repository.findByIdWithConfig(id)

      return result
  }

  async getHeadOffice(): Promise<UnitBusinessAttributes> {
    const headOffice = await this.repository.findOne({
      where: { head_office: true }
    })

    if (!headOffice) {
      throw Error('Matriz não cadastrada')
    }

    return headOffice
  }

  async update(
    id: string,
    data: Partial<UnitBusinessAttributes> & {
      label_stock_id?: string | null;
      label_shipping_id?: string | null;
    },
  ): Promise<UnitBusiness | null> {
    const { label_stock_id, label_shipping_id, ...unitBusinessData } = data;

    return sequelize.transaction(async (transaction) => {
      const updated = await this.repository.update(id, unitBusinessData, { transaction });

      if (label_stock_id !== undefined || label_shipping_id !== undefined) {
        const configPatch: Record<string, unknown> = {};
        if (label_stock_id !== undefined) configPatch.label_stock_id = label_stock_id;
        if (label_shipping_id !== undefined) configPatch.label_shipping_id = label_shipping_id;

        const existingConfig = await UnitBusinessConfig.findOne({
          where: { unit_business_id: id },
          transaction,
        });

        if (existingConfig) {
          await existingConfig.update(configPatch, { transaction });
        } else {
          await UnitBusinessConfig.create(
            { unit_business_id: id, ...configPatch },
            { transaction },
          );
        }
      }

      return updated;
    });
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

  async getComercialUnitBusinessOnly(): Promise<UnitBusinessAttributes[]> {

    const result = await this.findAll({
      where: {
        type: "PHYSICAL",
        number: {
          [Op.ne]: "0",
        }
      },
      order: [["number", "DESC"]]
    })

    if (!result) throw new Error("Nenhuma unit business válida para negócio cadastrada")


    return result
  }

  async shutdownRedis() {
    await redisService.client.quit();
  }
}

export default new UnitBusinessService();