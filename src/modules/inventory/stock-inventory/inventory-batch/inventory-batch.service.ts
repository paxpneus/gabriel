import BaseService from "../../../../shared/utils/base-models/base-service";
import InventoryBatch from "./inventory-batch.model";
import inventoryBatchRepository, { InventoryBatchRepository } from "./inventory-batch.repository";

export class InventoryBatchService extends BaseService<InventoryBatch, InventoryBatchRepository> {
    constructor() { super(inventoryBatchRepository) }
}
export default new InventoryBatchService();