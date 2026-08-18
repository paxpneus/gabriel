import { FindOptions, WhereOptions } from "sequelize";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Category from "./categories.model";
import CategoryOption from "../category-options/category-options.model";
import { CategoryWithOptions } from "./categories.types";
import {
  QueryParams,
  QueryConfig,
  PaginatedResult,
} from "../../../../../../../shared/query/query.types";
export class CategoryRepository extends BaseRepository<Category> {
  constructor() {
    super(Category);
  }

  findByIdWithOptions(
    id: string,
    options?: FindOptions,
  ): Promise<CategoryWithOptions | null> {
    const result = this.model.findByPk(id, {
      ...options,
      include: [
        {
          model: CategoryOption,
          as: "options",
        },
      ],
    });

    return result;
  }

  paginateWithOptions(
    params: QueryParams,
    config?: QueryConfig,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
    forcedWhere?: WhereOptions,
    forcedOrder?: FindOptions["order"],
  ): Promise<PaginatedResult<CategoryWithOptions>> {
    const result = super.findPaginated<CategoryWithOptions>(params, config, {
      include: [{
        model: CategoryOption,
        as: 'options'
      }]
    }, forcedWhere, forcedOrder)

    return result
  }
}
export default new CategoryRepository();
