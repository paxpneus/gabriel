import BaseService from "../../../../shared/utils/base-models/base-service";
import InventorySubgroup from "./inventory-subgroups.model";
import inventorySubgroupRepository, {
  InventorySubgroupRepository,
} from "./inventory-subgroups.repository";

export class InventorySubgroupService extends BaseService<
  InventorySubgroup,
  InventorySubgroupRepository
> {
  constructor() {
    super(inventorySubgroupRepository);

    this.queryConfig = {
      filterableFields: ["id", "inventory_batch_id", "subgroup_id"],
      sortableFields: ["createdAt"],
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
    };
  }
}

export default new InventorySubgroupService();
