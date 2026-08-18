import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Category from "./categories.model";
import categoryRepository, { CategoryRepository } from "./categories.repository";
export class CategoryService extends BaseService<Category, CategoryRepository> { constructor() { super(categoryRepository); this.queryConfig = { filterableFields: ["is_active"], sortableFields: ["name", "createdAt"], searchFields: ["name", "description"], defaults: { perPage: 20, sortBy: "name", sortDir: "ASC" } }; } }
export default new CategoryService();
