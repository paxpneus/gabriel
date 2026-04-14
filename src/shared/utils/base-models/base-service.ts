import {
  Model,
  FindOptions,
  CreateOptions,
  UpdateOptions,
  DestroyOptions,
  CreationAttributes,
  BulkCreateOptions,
} from "sequelize";
import BaseRepository from "./base-repository";
import {
  QueryParams,
  QueryConfig,
  PaginatedResult,
} from "./../../query/query.types";

class BaseService<
  T extends Model,
  Trepo extends BaseRepository<T> = BaseRepository<T>,
> {
  protected repository: Trepo;

  protected queryConfig: QueryConfig = {
    defaults: {
      perPage: 20,
      sortBy: "createdAt",
      sortDir: "DESC",
    },
  };

  constructor(repository: Trepo) {
    this.repository = repository;
  }

  findAll(options?: FindOptions) {
    return this.repository.findAll(options);
  }

  paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<T>> {
    return this.repository.findPaginated(
      params,
      this.queryConfig,
      extraOptions,
    );
  }

  findById(id: string, options?: FindOptions) {
    return this.repository.findById(id, options);
  }

  findOne(options?: FindOptions) {
    return this.repository.findOne(options);
  }

  create(data: Partial<T["_creationAttributes"]>, options?: CreateOptions) {
    return this.repository.create(data, options);
  }

  bulkCreate(datas: CreationAttributes<T>[], options?: BulkCreateOptions<T>) {
    return this.repository.bulkCreate(datas, options);
  }

  update(
    id: string,
    data: Partial<T["_creationAttributes"]>,
    options?: UpdateOptions,
  ) {
    return this.repository.update(id, data, options);
  }

  delete(id: string, options?: DestroyOptions) {
    return this.repository.delete(id, options);
  }
}

export default BaseService;
