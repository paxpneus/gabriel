import { Transaction } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import { syncPivotRows } from "../../../shared/utils/base-models/sync-pivot-rows";
import SupplierDiscountUnitBusiness from "./supplier-discount-unit-business.model";

export class SupplierDiscountUnitBusinessRepository extends BaseRepository<SupplierDiscountUnitBusiness> {
  constructor() {
    super(SupplierDiscountUnitBusiness);
  }

  async syncForRule(
    ruleId: string,
    unitBusinessIds: string[],
    options?: { transaction?: Transaction },
  ): Promise<void> {
    return syncPivotRows(
      SupplierDiscountUnitBusiness,
      {
        ownerField: "supplier_discount_rule_id",
        ownerId: ruleId,
        targetField: "unit_business_id",
        targetIds: unitBusinessIds,
      },
      options,
    );
  }
}

export default new SupplierDiscountUnitBusinessRepository();
