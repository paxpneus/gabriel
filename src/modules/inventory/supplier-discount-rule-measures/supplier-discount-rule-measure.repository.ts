import { Transaction } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import { syncPivotRows } from "../../../shared/utils/base-models/sync-pivot-rows";
import SupplierDiscountRuleMeasure from "./supplier-discount-rule-measure.model";

export class SupplierDiscountRuleMeasureRepository extends BaseRepository<SupplierDiscountRuleMeasure> {
  constructor() {
    super(SupplierDiscountRuleMeasure);
  }

  async syncForRule(
    ruleId: string,
    measureIds: string[],
    options?: { transaction?: Transaction },
  ): Promise<void> {
    return syncPivotRows(
      SupplierDiscountRuleMeasure,
      {
        ownerField: "supplier_discount_rule_id",
        ownerId: ruleId,
        targetField: "measure_id",
        targetIds: measureIds,
      },
      options,
    );
  }
}

export default new SupplierDiscountRuleMeasureRepository();
