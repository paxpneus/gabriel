import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import CategoryOption from "./category-options.model";
import categoryOptionRepository, { CategoryOptionRepository } from "./category-options.repository";
export class CategoryOptionService extends BaseService<CategoryOption, CategoryOptionRepository> { constructor() { super(categoryOptionRepository); this.queryConfig = { filterableFields: ["category_id", "is_active"], sortableFields: ["label", "display_order", "createdAt"], searchFields: ["label", "value"], defaults: { perPage: 20, sortBy: "display_order", sortDir: "ASC" } }; } }
export default new CategoryOptionService();
