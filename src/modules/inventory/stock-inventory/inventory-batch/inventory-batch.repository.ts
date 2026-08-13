import { Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import Stock from "../../stock/stock/stock.model";
import InventoryBatchItems from "../inventory-batch-items/inventory-batch-items.model";
import InventoryBatch from "./inventory-batch.model";

export class InventoryBatchRepository extends BaseRepository<InventoryBatch> {
  constructor() {
    super(InventoryBatch);
  }

  async syncBatchTotals(
    batchId: string,
    forceBatchFinish: boolean = true,
    t: Transaction,
  ): Promise<void> {
    const items = await InventoryBatchItems.findAll({
      where: { inventory_batch_id: batchId },
      include: [
        {
          model: Stock,
          as: "stock",
          attributes: ["quantity"],
        },
      ],
      transaction: t,
    });

    const totalQuantityRead = items.reduce(
      (sum, item) => sum + Number(item.quantity_read),
      0,
    );

    const totalQuantityStock = items.reduce(
      (sum, item) => sum + Number(item.quantity_stock),
      0,
    );

    const totalPrice = items.reduce((sum, item) => sum + Number(item.price), 0);

    const allFinished =
      items.length > 0 && items.every((i) => i.status === "FINISHED");

    const payload: Partial<InventoryBatch> = {
      total_quantity_read: totalQuantityRead,
      total_quantity_stock: totalQuantityStock,
      total_price: totalPrice,
    };

    if (forceBatchFinish) {
      const allFinished =
        items.length > 0 && items.every((i) => i.status === "FINISHED");
      payload.status = allFinished ? "FINISHED" : "PENDING";
    }

    await InventoryBatch.update(payload, {
      where: { id: batchId },
      transaction: t,
    });
  }
}
export default new InventoryBatchRepository();
