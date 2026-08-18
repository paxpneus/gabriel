import { FindOptions } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Category from "./categories.model";
import categoryRepository, {
  CategoryRepository,
} from "./categories.repository";
import { CategoryWithOptions } from "./categories.types";
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

  findByIdWithOptions(id: string, options?: FindOptions): Promise<CategoryWithOptions | null> {
      return this.repository.findByIdWithOptions(id, options);
  }
}
export default new CategoryService();
