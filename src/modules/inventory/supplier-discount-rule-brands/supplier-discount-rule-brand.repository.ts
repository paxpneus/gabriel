import { Transaction } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import { syncPivotRows } from "../../../shared/utils/base-models/sync-pivot-rows";
import SupplierDiscountRuleBrand from "./supplier-discount-rule-brand.model";

export class SupplierDiscountRuleBrandRepository extends BaseRepository<SupplierDiscountRuleBrand> {
  constructor() {
    super(SupplierDiscountRuleBrand);
  }

  async syncForRule(
    ruleId: string,
    brandIds: string[],
    options?: { transaction?: Transaction },
  ): Promise<void> {
    return syncPivotRows(
      SupplierDiscountRuleBrand,
      {
        ownerField: "supplier_discount_rule_id",
        ownerId: ruleId,
        targetField: "brand_id",
        targetIds: brandIds,
      },
      options,
    );
  }
}

export default new SupplierDiscountRuleBrandRepository();
