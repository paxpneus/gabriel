import BaseController from "../../../../../../../shared/utils/base-models/base-controller";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import Category from "./categories.model";
import categoryService, { CategoryService } from "./categories.service";
export class CategoryController extends BaseController<Category, CategoryService> { constructor() { super(categoryService); } protected middlewaresFor() { return { index: [authenticate, userPermissions], show: [authenticate, userPermissions], create: [authenticate, userPermissions], bulkCreate: [authenticate, userPermissions], update: [authenticate, userPermissions], destroy: [authenticate, userPermissions], bulkDestroy: [authenticate, userPermissions] }; } }
export default new CategoryController();
