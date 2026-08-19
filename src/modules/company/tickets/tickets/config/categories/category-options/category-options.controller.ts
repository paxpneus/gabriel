import BaseController from "../../../../../../../shared/utils/base-models/base-controller";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import CategoryOption from "./category-options.model";
import categoryOptionService, {
  CategoryOptionService,
} from "./category-options.service";
export class CategoryOptionController extends BaseController<
  CategoryOption,
  CategoryOptionService
> {
  constructor() {
    super(categoryOptionService);
  }
  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }
}
export default new CategoryOptionController();
