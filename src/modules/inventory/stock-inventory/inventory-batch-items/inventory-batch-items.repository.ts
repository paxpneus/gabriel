import { Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import InventoryBatchItems from "./inventory-batch-items.model";
import { inventoryBatchItemFull, Operation } from "./inventory-batch-items.types";
import inventoryBatchRepository from "../inventory-batch/inventory-batch.repository";
import InventoryBatchLogs from "../inventory-batch-logs/inventory-batch-logs.model";
import Product from "../../products/product.model";
import Stock from "../../stock/stock/stock.model";
import sequelize from "../../../../config/sequelize";
import inventoryBatchService from "../inventory-batch/inventory-batch.service";

export class InventoryBatchItemsRepository extends BaseRepository<InventoryBatchItems> {
    constructor() { super(InventoryBatchItems) }


     async upsertItem(
    {
      batchId,
      productId,
      stockId,
      ean,
      sku,
      quantityStock,
    }: {
      batchId: string;
      productId: string;
      stockId: string;
      ean: string;
      sku: string;
      quantityStock: number;
    },
    t: Transaction,
  ): Promise<InventoryBatchItems> {
    let item = await InventoryBatchItems.findOne({
      where: { product_id: productId, inventory_batch_id: batchId, stock_id: stockId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!item) {
      item = await InventoryBatchItems.create(
        {
          product_id: productId,
          inventory_batch_id: batchId,
          ean,
          sku,
          quantity_stock: quantityStock,
          quantity_read: 0,
          divergency: quantityStock,
          initial_divergency: quantityStock,
          stock_id: stockId,
          status: "PENDING",
        },
        { transaction: t },
      );
    }

    await  inventoryBatchRepository.syncBatchTotals(batchId, true, t);

    return item;
  }

  async removeItem(id: string, batchId: string): Promise<void> {
    await sequelize.transaction(async (t) => {
      const inventoryBatch = await inventoryBatchService.findByIdFullBatch(batchId);
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
        lock: {
          level: t.LOCK.UPDATE,
          of: InventoryBatchItems,
        },
      })) as unknown as inventoryBatchItemFull;

      if (!batchItem) throw new Error("Item não encontrado");

      await InventoryBatchLogs.destroy({
        where: { inventory_batch_item_id: batchItem.id },
        transaction: t,
      });

      await this.delete(id, { transaction: t });

      await inventoryBatchRepository.syncBatchTotals(batchId, false, t);
    });
  }

}
export default new InventoryBatchItemsRepository();