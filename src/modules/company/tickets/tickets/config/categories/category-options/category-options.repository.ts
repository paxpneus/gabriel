import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import CategoryOption from "./category-options.model";
export class CategoryOptionRepository extends BaseRepository<CategoryOption> { constructor() { super(CategoryOption); } }
export default new CategoryOptionRepository();
