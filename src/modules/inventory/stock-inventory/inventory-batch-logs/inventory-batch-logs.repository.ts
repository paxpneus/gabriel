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
  ): Promise<{
    newStatus: string;
    newUserRead: number;
    quantityStock: number;
    quantityRead: number;
    divergency: number;
    totalQuantityRead: number;
    totalQuantityStock: number;
    itemCount: number;
    finishedCount: number;
  }> {
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

    // Soma por usuário primeiro: correção manual sempre cria um novo log em vez
    // de editar o existente, então um mesmo usuário pode ter vários logs aqui.
    const userReadsByUser = allLogs.reduce<Record<string, number>>(
      (acc, log) => {
        const logUserId = log.user_id;
        acc[logUserId] = (acc[logUserId] ?? 0) + Number(log.quantity_read);
        return acc;
      },
      {},
    );

    // Max entre a soma do usuário atual e a maior soma entre os demais usuários = quantity_read do item
    const newUserRead = userReadsByUser[userId] ?? 0;
    const otherUserReads = Object.entries(userReadsByUser)
      .filter(([logUserId]) => logUserId !== userId)
      .map(([, value]) => value);
    const maxOtherRead = otherUserReads.length ? Math.max(...otherUserReads) : 0;

    const newItemQuantityRead = Math.max(newUserRead, maxOtherRead);

    const userReadValues = Object.values(userReadsByUser);
    const hasMultipleUserReads = userReadValues.length > 1;
    const maxUserRead =
      userReadValues.length > 0 ? Math.max(...userReadValues) : 0;
    const minUserRead =
      userReadValues.length > 0 ? Math.min(...userReadValues) : 0;
    const userDivergency =
      hasMultipleUserReads ? Math.abs(maxUserRead - minUserRead) : 0;

    const hasUserDivergency = userDivergency > 0;
    const allUsersReadEqual = hasMultipleUserReads && maxUserRead === minUserRead;
    const anyUserReadEnough = userReadValues.some(
      (value) => value >= Number(item.quantity_stock),
    );

    const newStatus =
      batchType === "DIVERGENCY"
        ? hasMultipleUserReads && allUsersReadEqual && anyUserReadEnough
          ? "FINISHED"
          : "PENDING"
        : !hasUserDivergency && anyUserReadEnough
          ? "FINISHED"
          : "PENDING";

    const divergency = Number(item.quantity_stock) - newItemQuantityRead;

    await item.update(
      {
        quantity_read: newItemQuantityRead,
        divergency,
        price: newItemQuantityRead * (options?.unitPrice ?? 0),
        status: newStatus,
        ...(batchType === "REGULAR" &&
          !options?.skipInitialDivergency && {
            initial_divergency: userDivergency,
          }),
      },
      { transaction: t },
    );

    const batchTotals = await inventoryBatchRepository.syncBatchTotals(
      batchId,
      false,
      t,
    );

    return {
      newStatus,
      newUserRead,
      quantityStock: Number(item.quantity_stock),
      quantityRead: newItemQuantityRead,
      divergency,
      totalQuantityRead: batchTotals.totalQuantityRead,
      totalQuantityStock: batchTotals.totalQuantityStock,
      itemCount: batchTotals.itemCount,
      finishedCount: batchTotals.finishedCount,
    };
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
