import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import InventoryBatchItems from "./inventory-batch-items.model";

export class InventoryBatchItemsRepository extends BaseRepository<InventoryBatchItems> {
    constructor() { super(InventoryBatchItems) }
}
export default new InventoryBatchItemsRepository();