import { includes } from "zod";
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

export class InventoryBatchItemsService extends BaseService<
  InventoryBatchItems,
  InventoryBatchItemsRepository
> {
  constructor() {
    super(inventoryBatchItemsRepository);
  }

  async removeItem(id: string, batchId: string): Promise<void> {
      const inventoryBatch =
        await inventoryBatchService.findByIdFullBatch(batchId);
      if (!inventoryBatch) throw new Error("Lote não encontrado");

      if (!["OPEN", "PENDING"].includes(inventoryBatch.status)) throw new Error("Não permitido remover itens de lotes com processo encerrado!")

     await this.repository.removeItem(id, batchId)
  }

  // Correção manual de admin: delega pro inventoryBatchLogsService, que reusa syncItemAndBatchAfterScan (mesmo caminho do scanProduct).
  updateItemQuantity(
    itemId: string,
    quantity: number,
    userId: string,
    roleId: string,
  ): Promise<boolean> {
    return inventoryBatchLogsService.updateItemQuantity(
      itemId,
      quantity,
      userId,
      roleId,
    );
  }
}
export default new InventoryBatchItemsService();
