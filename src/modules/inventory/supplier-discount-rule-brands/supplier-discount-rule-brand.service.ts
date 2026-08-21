import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import SupplierDiscountRuleBrand from "./supplier-discount-rule-brand.model";
import supplierDiscountRuleBrandRepository, {
  SupplierDiscountRuleBrandRepository,
} from "./supplier-discount-rule-brand.repository";

export class SupplierDiscountRuleBrandService extends BaseService<
  SupplierDiscountRuleBrand,
  SupplierDiscountRuleBrandRepository
> {
  constructor() {
    super(supplierDiscountRuleBrandRepository);
  }

  async syncForRule(
    ruleId: string,
    brandIds: string[],
    options?: { transaction?: Transaction },
  ): Promise<void> {
    return this.repository.syncForRule(ruleId, brandIds, options);
  }
}

export default new SupplierDiscountRuleBrandService();
