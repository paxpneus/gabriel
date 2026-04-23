import BaseController from "../../../../shared/utils/base-models/base-controller";
import InventoryBatch from "./inventory-batch.model";
import inventoryBatchService, { InventoryBatchService } from "./inventory-batch.service";

class InventoryBatchController extends BaseController<InventoryBatch, InventoryBatchService> {
    constructor() { super(inventoryBatchService) }
}
export default new InventoryBatchController();