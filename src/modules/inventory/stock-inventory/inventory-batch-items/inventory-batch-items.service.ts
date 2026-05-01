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

      const batchItem = (await this.findById(id, {
        include: [
          {
            model: Product,
            as: "product",
            include: [
              {
                model: Stock,
                as: "stocks",
                where: { unit_business_id: inventoryBatch.unit_business_id },
              },
            ],
          },
        ],
        transaction: t,
      })) as unknown as inventoryBatchItemFull;

      if (!batchItem) throw new Error("Item não encontrado");

      // ── 1. O quantity_read atual do item JÁ É o max entre os usuários ────────
      //    (mantido em sincronia pelo scanProduct e updateLogQuantity)
      //    então basta usar diretamente para decrementar o batch
      const currentItemRead = Number(batchItem.quantity_read);

      if (currentItemRead > 0) {
        await InventoryBatch.decrement("total_quantity_read", {
          by: currentItemRead,
          where: { id: batchItem.inventory_batch_id },
          transaction: t,
        });
      }

      // ── 2. Decrementa total_quantity_stock ────────────────────────────────────
      const stockQty = batchItem.product?.stocks?.[0]?.quantity ?? 0;
      if (stockQty > 0) {
        await InventoryBatch.decrement("total_quantity_stock", {
          by: stockQty,
          where: { id: batchItem.inventory_batch_id },
          transaction: t,
        });
      }

      // ── 3. Remove logs e item ─────────────────────────────────────────────────
      await InventoryBatchLogs.destroy({
        where: { inventory_batch_item_id: batchItem.id },
        transaction: t,
      });

      await this.delete(id, { transaction: t });
    });
  }
}
export default new InventoryBatchItemsService();
