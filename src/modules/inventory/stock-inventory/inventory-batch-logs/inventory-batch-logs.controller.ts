import BaseController from "../../../../shared/utils/base-models/base-controller";
import InventoryBatchLogs from "./inventory-batch-logs.model";
import inventoryBatchLogsService, { InventoryBatchLogsService } from "./inventory-batch-logs.service";

class InventoryBatchLogsController extends BaseController<InventoryBatchLogs, InventoryBatchLogsService> {
    constructor() { super(inventoryBatchLogsService) }
}
export default new InventoryBatchLogsController();