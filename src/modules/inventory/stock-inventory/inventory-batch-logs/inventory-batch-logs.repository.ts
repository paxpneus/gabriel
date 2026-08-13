import { Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import InventoryBatchLogs from "./inventory-batch-logs.model";
import InventoryBatchItems from "../inventory-batch-items/inventory-batch-items.model";
import inventoryBatchRepository from "../inventory-batch/inventory-batch.repository";
import Product from "../../products/product.model";
import { inventoryBatchItemFull } from "../inventory-batch-items/inventory-batch-items.types";

export class InventoryBatchLogsRepository extends BaseRepository<InventoryBatchLogs> {
  constructor() {
    super(InventoryBatchLogs);
  }

  async syncItemAndBatchAfterScan(
    itemId: string,
    batchId: string,
    userId: string,
    batchType: string,
    t: Transaction,
    options?: { skipInitialDivergency?: boolean; unitPrice?: number },
  ): Promise<{ newStatus: string; newUserRead: number }> {
    const allLogs = await InventoryBatchLogs.findAll({
      where: { inventory_batch_item_id: itemId },
      transaction: t,
    });

    const item = await InventoryBatchItems.findByPk(itemId, {
      include: [
        {
          model: Product,
          as: "product",
        },
      ],
      transaction: t,
    });
    if (!item) throw new Error("Item não encontrado");

    // Max entre todos os logs = quantity_read do item
    const userLog = allLogs.find((l) => l.user_id === userId);
    const newUserRead = userLog ? Number(userLog.quantity_read) : 0;
    const maxOtherRead = allLogs
      .filter((l) => l.user_id !== userId)
      .reduce((max, l) => Math.max(max, Number(l.quantity_read)), 0);

    const newItemQuantityRead = Math.max(newUserRead, maxOtherRead);

    const userDivergency =
      allLogs.length === 2
        ? Math.abs(
            Number(allLogs[0].quantity_read) - Number(allLogs[1].quantity_read),
          )
        : 0;

    const hasUserDivergency = userDivergency > 0;
    const anyUserReadEnough = allLogs.some(
      (l) => Number(l.quantity_read) >= Number(item.quantity_stock),
    );
    const newStatus =
      !hasUserDivergency && anyUserReadEnough ? "FINISHED" : "PENDING";

    await item.update(
      {
        quantity_read: newItemQuantityRead,
        divergency: Number(item.quantity_stock) - newItemQuantityRead,
        price: newItemQuantityRead * (options?.unitPrice ?? 0),
        status: newStatus,
        ...(batchType === "REGULAR" &&
          !options?.skipInitialDivergency && {
            initial_divergency: userDivergency,
          }),
      },
      { transaction: t },
    );

    await inventoryBatchRepository.syncBatchTotals(batchId, false, t);

    return { newStatus, newUserRead };
  }

  async syncDivergencyParent(
    {
      parentBatchId,
      productcode,
      stockId,
      userId,
      itemId,
    }: {
      parentBatchId: string;
      productcode: string;
      stockId: string;
      userId: string;
      itemId: string;
    },
    t: Transaction,
  ): Promise<void> {
    const childItem = await InventoryBatchItems.findByPk(itemId, {
      transaction: t,
    });
    if (childItem?.status !== "FINISHED") return;

    const parentItem = await InventoryBatchItems.findOne({
      where: {
        ean: productcode,
        inventory_batch_id: parentBatchId,
        stock_id: stockId,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!parentItem) return;

    const childLog = await InventoryBatchLogs.findOne({
      where: { user_id: userId, inventory_batch_item_id: itemId },
      transaction: t,
    });
    const newUserRead = childLog ? Number(childLog.quantity_read) : 0;

    const existingParentLog = await InventoryBatchLogs.findOne({
      where: { user_id: userId, inventory_batch_item_id: parentItem.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (existingParentLog) {
      await existingParentLog.update(
        { quantity_read: newUserRead },
        { transaction: t },
      );
    } else {
      await InventoryBatchLogs.create(
        {
          user_id: userId,
          quantity_read: newUserRead,
          label_code: productcode,
          inventory_batch_item_id: parentItem.id,
          date: new Date(),
        },
        { transaction: t },
      );
    }

    await this.syncItemAndBatchAfterScan(
      parentItem.id,
      parentBatchId,
      userId,
      "REGULAR",
      t,
      { skipInitialDivergency: true },
    );
  }
}
export default new InventoryBatchLogsRepository();
