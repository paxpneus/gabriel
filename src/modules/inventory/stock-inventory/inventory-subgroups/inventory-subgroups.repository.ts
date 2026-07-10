import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import InventorySubgroup from "./inventory-subgroups.model";

export class InventorySubgroupRepository extends BaseRepository<InventorySubgroup> {
  constructor() {
    super(InventorySubgroup);
  }
}

export default new InventorySubgroupRepository();
