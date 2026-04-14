import { Model, ModelStatic, FindOptions, CreateOptions, UpdateOptions, DestroyOptions, CreationAttributes, BulkCreateOptions } from 'sequelize'
import { QueryParser } from './../../query/query.parser';
import type { QueryParams, QueryConfig, PaginatedResult, ResolvedQuery } from './../../query/query.types';


class BaseRepository<T extends Model> {
  protected model: ModelStatic<T>

  constructor(model: ModelStatic<T>) {
    this.model = model
  }

  findAll(options?: FindOptions): Promise<T[]> {
    return this.model.findAll(options)
  }

   async findPaginated(
    params: QueryParams,
    config: QueryConfig = {},
    extraOptions: Omit<FindOptions, 'where' | 'limit' | 'offset' | 'order'> = {}
  ): Promise<PaginatedResult<T>> {
    const resolved = QueryParser.parse(params, config)
 
    const { rows, count } = await this.model.findAndCountAll({
      ...extraOptions,
      where: resolved.where,
      limit: resolved.limit,
      offset: resolved.offset,
      order: resolved.order,
    })
 
    return {
      data: rows,
      meta: QueryParser.buildMeta(count, resolved.page, resolved.perPage),
    }
  }

  findOne(options?: FindOptions): Promise<T | null> {
    return this.model.findOne(options)
  }

  findById(id: string, options?: FindOptions): Promise<T | null> {
    return this.model.findByPk(id, options)
  }

  create(
    data: Partial<T['_creationAttributes']>,
    options?: CreateOptions
  ): Promise<T> {
    return this.model.create(data as any, options)
  }

  bulkCreate(
    datas: CreationAttributes<T>[],
    options?: BulkCreateOptions<T>
  ): Promise<T[]> {
    return this.model.bulkCreate(datas, options)
  }

  async update(
    id: string,
    data: Partial<T['_creationAttributes']>,
    options?: UpdateOptions
  ): Promise<T | null> {
    const record = await this.model.findByPk(id, options)
    if (!record) return null
    return record.update(data as any, options)
  }

  async bulkUpdate(
    data: Partial<T['_creationAttributes']>,
    options: UpdateOptions
  ): Promise<[number]> {
    return this.model.update(data as any, options) as Promise<[number]>
  }

  async delete(
    id: string,
    options?: DestroyOptions
  ): Promise<boolean> {
    const record = await this.model.findByPk(id, options)
    if (!record) return false
    await record.destroy(options)
    return true
  }
}

export default BaseRepository