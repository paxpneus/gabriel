import BaseService from "../../../../shared/utils/base-models/base-service";
import InventoryBatchLogs from "./inventory-batch-logs.model";
import inventoryBatchLogsRepository, { InventoryBatchLogsRepository } from "./inventory-batch-logs.repository";

export class InventoryBatchLogsService extends BaseService<InventoryBatchLogs, InventoryBatchLogsRepository> {
    constructor() { super(inventoryBatchLogsRepository) }
}
export default new InventoryBatchLogsService();