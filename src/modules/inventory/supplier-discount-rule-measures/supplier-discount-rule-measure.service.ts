import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import SupplierDiscountRuleMeasure from "./supplier-discount-rule-measure.model";
import supplierDiscountRuleMeasureRepository, {
  SupplierDiscountRuleMeasureRepository,
} from "./supplier-discount-rule-measure.repository";

export class SupplierDiscountRuleMeasureService extends BaseService<
  SupplierDiscountRuleMeasure,
  SupplierDiscountRuleMeasureRepository
> {
  constructor() {
    super(supplierDiscountRuleMeasureRepository);
  }

  async syncForRule(
    ruleId: string,
    measureIds: string[],
    options?: { transaction?: Transaction },
  ): Promise<void> {
    return this.repository.syncForRule(ruleId, measureIds, options);
  }
}

export default new SupplierDiscountRuleMeasureService();
