import {
  Model,
  ModelStatic,
  FindOptions,
  CreateOptions,
  UpdateOptions,
  DestroyOptions,
  CreationAttributes,
  BulkCreateOptions,
} from "sequelize";
import { QueryParser } from "./../../query/query.parser";
import type {
  QueryParams,
  QueryConfig,
  PaginatedResult,
  ResolvedQuery,
} from "./../../query/query.types";

class BaseRepository<T extends Model> {
  protected model: ModelStatic<T>;

  constructor(model: ModelStatic<T>) {
    this.model = model;
  }

  findAll(
    options?: FindOptions,
    params?: QueryParams,
    config?: QueryConfig,
  ): Promise<T[]> {
    if (params) {
      const resolved = QueryParser.parse(params, config ?? {});
      return this.model.findAll({
        ...options,
        where: resolved.where,
        order: resolved.order,
      });
    }
    return this.model.findAll(options);
  }

  async findPaginated(
    params: QueryParams,
    config: QueryConfig = {},
    extraOptions: Omit<
      FindOptions,
      "where" | "limit" | "offset" | "order"
    > = {},
  ): Promise<PaginatedResult<T>> {
    const resolved = QueryParser.parse(params, config);

    const { rows, count } = await this.model.findAndCountAll({
      ...extraOptions,
      where: resolved.where,
      limit: resolved.limit,
      offset: resolved.offset,
      order: resolved.order,
    });

    return {
      data: rows,
      meta: QueryParser.buildMeta(count, resolved.page, resolved.perPage),
    };
  }

  findOne(options?: FindOptions): Promise<T | null> {
    return this.model.findOne(options);
  }

  findById(id: string, options?: FindOptions): Promise<T | null> {
    return this.model.findByPk(id, options);
  }

  create(
    data: Partial<T["_creationAttributes"]>,
    options?: CreateOptions,
  ): Promise<T> {
    return this.model.create(data as any, options);
  }

  bulkCreate(
    datas: CreationAttributes<T>[],
    options?: BulkCreateOptions<T>,
  ): Promise<T[]> {
    return this.model.bulkCreate(datas, options);
  }

  async update(
    id: string,
    data: Partial<T["_creationAttributes"]>,
    options?: Partial<UpdateOptions>,
  ): Promise<T | null> {
    const record = await this.model.findByPk(id, options);
    if (!record) return null;
    return record.update(data as any, options);
  }

  async bulkUpdate(
    data: Partial<T["_creationAttributes"]>,
    options: UpdateOptions,
  ): Promise<[number]> {
    return this.model.update(data as any, options) as Promise<[number]>;
  }

  async increment(
    field: string,
    options: { by: number; where: any; transaction?: any },
  ): Promise<void> {
    await this.model.increment(field, {
      by: options.by,
      where: options.where,
      transaction: options.transaction,
    });
  }

  async decrement(
    field: string,
    options: { by: number; where: any; transaction?: any },
  ): Promise<void> {
    await this.model.decrement(field, {
      by: options.by,
      where: options.where,
      transaction: options.transaction,
    });
  }

  async upsertByFind(
    where: FindOptions["where"],
    updateData: Partial<T["_creationAttributes"]>,
    createData: Partial<T["_creationAttributes"]>,
    options?: { transaction?: any },
  ): Promise<T> {
    const record = await this.model.findOne({
      where,
      transaction: options?.transaction,
    });
    if (record) {
      return record.update(updateData as any, {
        transaction: options?.transaction,
      });
    }
    return this.model.create({ ...createData } as any, {
      transaction: options?.transaction,
    });
  }

  async findOneAndUpdate(
    where: FindOptions["where"],
    data: Partial<T["_creationAttributes"]>,
    options?: { transaction?: any },
  ): Promise<T> {
    const record = await this.model.findOne({
      where,
      transaction: options?.transaction,
    });
    if (record) {
      return record.update(data as any, { transaction: options?.transaction });
    }
    return this.model.create({ ...where, ...data } as any, {
      transaction: options?.transaction,
    });
  }

  async delete(id: string, options?: DestroyOptions): Promise<boolean> {
    const record = await this.model.findByPk(id, options);
    if (!record) return false;
    await record.destroy(options);
    return true;
  }

  async bulkDelete(options: DestroyOptions): Promise<number> {
    return this.model.destroy(options);
  }
}

export default BaseRepository;
