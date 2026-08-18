import { DestroyOptions, FindOptions, Op, WhereOptions, Transaction } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import { throwIfEntityIsInUse } from "../../../../../../../shared/utils/validators/entity-in-use";
import Category from "./categories.model";
import categoryRepository, {
  CategoryRepository,
} from "./categories.repository";
import { CategoryWithOptions } from "./categories.types";
import {
  QueryParams,
  PaginatedResult,
} from "../../../../../../../shared/query/query.types";
import categoryOptionService from "../category-options/category-options.service";
import CategoryOption from "../category-options/category-options.model";
import { CategoryOptionUpdateAttributes } from "../category-options/category-options.types";
import TicketCategoryOption from "../../../ticket-category-options/ticket-category-options.model";

export class CategoryService extends BaseService<Category, CategoryRepository> {
  constructor() {
    super(categoryRepository);
    this.queryConfig = {
      filterableFields: ["is_active"],
      sortableFields: ["name", "createdAt"],
      searchFields: ["name", "description"],
      defaults: { perPage: 20, sortBy: "name", sortDir: "ASC" },
    };
  }

  findByIdWithOptions(
    id: string,
    options?: FindOptions,
  ): Promise<CategoryWithOptions | null> {
    return this.repository.findByIdWithOptions(id, options);
  }

  paginateWithOptions(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
    forcedWhere?: WhereOptions,
  ): Promise<PaginatedResult<CategoryWithOptions>> {
    return this.repository.paginateWithOptions(
      params,
      this.queryConfig,
      extraOptions,
      forcedWhere,
    );
  }

  private async ensureNotUsed(categoryIds: string | string[]): Promise<void> {
    const categoryOptionIds = await CategoryOption.findAll({
      attributes: ["id"],
      where: {
        category_id: Array.isArray(categoryIds)
          ? { [Op.in]: categoryIds }
          : categoryIds,
      },
      raw: true,
    });

    const optionIds = categoryOptionIds.map((option) => option.id);
    if (!optionIds.length) return;

    await throwIfEntityIsInUse(TicketCategoryOption, {
      category_option_id: { [Op.in]: optionIds },
    });
  }

  async delete(id: string, options?: DestroyOptions) {
    await this.ensureNotUsed(id);
    return super.delete(id, options);
  }

  async bulkDelete(options: DestroyOptions) {
    const ids = (options.where as { id?: { [Op.in]?: string[] } })?.id?.[Op.in];

    if (ids?.length) await this.ensureNotUsed(ids);
    return super.bulkDelete(options);
  }

  /**
   * Edita a category e, na mesma transaction, edita cada uma das
   * category options informadas (cada item precisa ter `id`).
   */
  async updateWithOptions(
    id: string,
    data: Partial<Category["_creationAttributes"]>,
    categoryOptions: CategoryOptionUpdateAttributes[] = [],
    externalTransaction?: Transaction,
  ): Promise<CategoryWithOptions | null> {
    const isExternalTransaction = !!externalTransaction;
    const transaction =
      externalTransaction ?? (await Category.sequelize!.transaction());

    try {
      await this.repository.update(id, data, { transaction });

      if (categoryOptions.length) {
        await Promise.all(
          categoryOptions.map(({ id: optionId, ...optionData }) =>
            categoryOptionService.update(optionId, optionData, {
              transaction,
            }),
          ),
        );
      }

      if (!isExternalTransaction) {
        await transaction.commit();
      }

      return this.findByIdWithOptions(
        id,
        isExternalTransaction ? { transaction } : undefined,
      );
    } catch (error) {
      if (!isExternalTransaction) {
        await transaction.rollback();
      }
      throw error;
    }
  }
}

export default new CategoryService();
