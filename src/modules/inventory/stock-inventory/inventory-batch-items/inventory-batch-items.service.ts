import BaseService from "../../../../shared/utils/base-models/base-service";
import InventoryBatchItems from "./inventory-batch-items.model";
import inventoryBatchItemsRepository, { InventoryBatchItemsRepository } from "./inventory-batch-items.repository";

export class InventoryBatchItemsService extends BaseService<InventoryBatchItems, InventoryBatchItemsRepository> {
    constructor() { super(inventoryBatchItemsRepository) }
}
export default new InventoryBatchItemsService();