import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import InventoryBatchLogs from "./inventory-batch-logs.model";

export class InventoryBatchLogsRepository extends BaseRepository<InventoryBatchLogs> {
    constructor() { super(InventoryBatchLogs) }
}
export default new InventoryBatchLogsRepository();