import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import InventoryBatch from "./inventory-batch.model";

export class InventoryBatchRepository extends BaseRepository<InventoryBatch> {
    constructor() { super(InventoryBatch) }
}
export default new InventoryBatchRepository();