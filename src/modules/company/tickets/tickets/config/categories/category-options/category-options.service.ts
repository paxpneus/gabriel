import { DestroyOptions, Op } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import { throwIfEntityIsInUse } from "../../../../../../../shared/utils/validators/entity-in-use";
import TicketCategoryOption from "../../../ticket-category-options/ticket-category-options.model";
import CategoryOption from "./category-options.model";
import categoryOptionRepository, { CategoryOptionRepository } from "./category-options.repository";

export class CategoryOptionService extends BaseService<
  CategoryOption,
  CategoryOptionRepository
> {
  constructor() {
    super(categoryOptionRepository);
    this.queryConfig = {
      filterableFields: ["category_id", "is_active"],
      sortableFields: ["label", "display_order", "createdAt"],
      searchFields: ["label", "value"],
      defaults: { perPage: 20, sortBy: "display_order", sortDir: "ASC" },
    };
  }

  private async ensureNotUsed(optionIds: string | string[]): Promise<void> {
    await throwIfEntityIsInUse(TicketCategoryOption, {
      category_option_id: Array.isArray(optionIds)
        ? { [Op.in]: optionIds }
        : optionIds,
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
}
export default new CategoryOptionService();
