import { FindOptions } from "sequelize";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Category from "./categories.model";
import CategoryOption from "../category_options/category-options.model";
import { CategoryWithOptions } from "./categories.types";
export class CategoryRepository extends BaseRepository<Category> {
  constructor() {
    super(Category);
  }

  findByIdWithOptions(id: string, options?: FindOptions): Promise<CategoryWithOptions | null> {
      const result = this.model.findByPk(id, {
        ...options,
        include: [
            {
                model: CategoryOption,
                as: 'options'
            }
        ]
      })

      return result
  }
}
export default new CategoryRepository();
