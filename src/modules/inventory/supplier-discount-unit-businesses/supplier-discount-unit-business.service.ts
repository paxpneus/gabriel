import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import SupplierDiscountUnitBusiness from "./supplier-discount-unit-business.model";
import supplierDiscountUnitBusinessRepository, {
  SupplierDiscountUnitBusinessRepository,
} from "./supplier-discount-unit-business.repository";

export class SupplierDiscountUnitBusinessService extends BaseService<
  SupplierDiscountUnitBusiness,
  SupplierDiscountUnitBusinessRepository
> {
  constructor() {
    super(supplierDiscountUnitBusinessRepository);
  }

  async syncForRule(
    ruleId: string,
    unitBusinessIds: string[],
    options?: { transaction?: Transaction },
  ): Promise<void> {
    return this.repository.syncForRule(ruleId, unitBusinessIds, options);
  }
}

export default new SupplierDiscountUnitBusinessService();
