import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController from "../../../shared/utils/base-models/base-controller";
import SupplierDiscountRule from "./supplier-discount-rule.model";
import SupplierDiscountRuleService from "./supplier-discount-rule.service";

export class SupplierDiscountRuleController extends BaseController<
  SupplierDiscountRule,
  typeof SupplierDiscountRuleService
> {
  constructor() {
    super(SupplierDiscountRuleService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
    };
  }
}

export default new SupplierDiscountRuleController();
