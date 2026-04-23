import BaseController from "../../../../shared/utils/base-models/base-controller";
import InventoryBatchItems from "./inventory-batch-items.model";
import inventoryBatchItemsService, { InventoryBatchItemsService } from "./inventory-batch-items.service";

class InventoryBatchItemsController extends BaseController<InventoryBatchItems, InventoryBatchItemsService> {
    constructor() { super(inventoryBatchItemsService) }
}
export default new InventoryBatchItemsController();