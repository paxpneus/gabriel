import { FindOptions } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Label from "../../../inventory/labels/labels.model";
import UnitBusinessConfig from "./unit-business-config.model";
import unitBusinessConfigRepository, {
  UnitBusinessConfigRepository,
} from "./unit-business-config.repository";

export class UnitBusinessConfigService extends BaseService<
  UnitBusinessConfig,
  UnitBusinessConfigRepository
> {
  constructor() {
    super(unitBusinessConfigRepository);

    this.queryConfig = {
      filterableFields: [
        "id",
        "unit_business_id",
        "label_stock_id",
        "label_shipping_id",
      ],
      sortableFields: ["createdAt", "unit_business_id"],
      searchFields: ["unit_business_id"],
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
    };
  }

  async findByUnitBusinessId(unitBusinessId: string) {
    return this.repository.findOne({
      where: { unit_business_id: unitBusinessId },
      include: [
        { model: Label, as: "stockLabel" },
        { model: Label, as: "shippingLabel" },
      ],
    } as FindOptions<any>);
  }
}

export default new UnitBusinessConfigService();
