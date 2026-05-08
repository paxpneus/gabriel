import { includes } from "zod";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import inventoryBatchLogsService from "../inventory-batch-logs/inventory-batch-logs.service";
import InventoryBatch from "../inventory-batch/inventory-batch.model";
import inventoryBatchService, {
  InventoryBatchService,
} from "../inventory-batch/inventory-batch.service";
import InventoryBatchItems from "./inventory-batch-items.model";
import inventoryBatchItemsRepository, {
  InventoryBatchItemsRepository,
} from "./inventory-batch-items.repository";
import Product from "../../products/product.model";
import { inventoryBatchItemFull } from "./inventory-batch-items.types";
import Stock from "../../stock/stock.model";
import scanLogsService from "../../../warehouse/expedition/scan-logs/scan-logs.service";
import InventoryBatchLogs from "../inventory-batch-logs/inventory-batch-logs.model";

export class InventoryBatchItemsService extends BaseService<
  InventoryBatchItems,
  InventoryBatchItemsRepository
> {
  constructor() {
    super(inventoryBatchItemsRepository);
  }

  async removeItem(id: string, batchId: string): Promise<void> {
    await sequelize.transaction(async (t) => {
      const inventoryBatch =
        await inventoryBatchService.findByIdFullBatch(batchId);
      if (!inventoryBatch) throw new Error("Lote não encontrado");

     this.repository.removeItem(id, batchId)
    });
  }
}
export default new InventoryBatchItemsService();
