import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Category from "./categories.model";
export class CategoryRepository extends BaseRepository<Category> { constructor() { super(Category); } }
export default new CategoryRepository();
