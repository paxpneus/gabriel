import { Transaction } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import { syncPivotRows } from "../../../shared/utils/base-models/sync-pivot-rows";
import SupplierDiscountRuleRim from "./supplier-discount-rule-rim.model";

export class SupplierDiscountRuleRimRepository extends BaseRepository<SupplierDiscountRuleRim> {
  constructor() {
    super(SupplierDiscountRuleRim);
  }

  async syncForRule(
    ruleId: string,
    rimIds: string[],
    options?: { transaction?: Transaction },
  ): Promise<void> {
    return syncPivotRows(
      SupplierDiscountRuleRim,
      {
        ownerField: "supplier_discount_rule_id",
        ownerId: ruleId,
        targetField: "rim_id",
        targetIds: rimIds,
      },
      options,
    );
  }
}

export default new SupplierDiscountRuleRimRepository();
