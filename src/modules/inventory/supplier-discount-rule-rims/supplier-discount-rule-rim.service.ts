import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import SupplierDiscountRuleRim from "./supplier-discount-rule-rim.model";
import supplierDiscountRuleRimRepository, {
  SupplierDiscountRuleRimRepository,
} from "./supplier-discount-rule-rim.repository";

export class SupplierDiscountRuleRimService extends BaseService<
  SupplierDiscountRuleRim,
  SupplierDiscountRuleRimRepository
> {
  constructor() {
    super(supplierDiscountRuleRimRepository);
  }

  async syncForRule(
    ruleId: string,
    rimIds: string[],
    options?: { transaction?: Transaction },
  ): Promise<void> {
    return this.repository.syncForRule(ruleId, rimIds, options);
  }
}

export default new SupplierDiscountRuleRimService();
