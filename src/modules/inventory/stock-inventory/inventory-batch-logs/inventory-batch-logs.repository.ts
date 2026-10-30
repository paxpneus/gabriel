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

  // Item do lote de divergência finalizado → leva o total recontado de CADA conferente pro item do lote pai.
  // Grava log de delta (nunca edita log existente): no pai um conferente pode ter vários logs (correções manuais).
  async syncDivergencyParent(
    {
      parentBatchId,
      itemId,
      unitPrice,
    }: {
      parentBatchId: string;
      itemId: string;
      unitPrice?: number;
    },
    t: Transaction,
  ): Promise<void> {
    const childItem = await InventoryBatchItems.findByPk(itemId, {
      attributes: ["id", "product_id", "status"],
      transaction: t,
    });
    if (childItem?.status !== "FINISHED") return;

    // Por product_id (unique no lote), não pelo código bipado: o bipado pode ser variação de zero/código da integração.
    const parentItem = await InventoryBatchItems.findOne({
      attributes: ["id"],
      where: {
        product_id: childItem.product_id,
        inventory_batch_id: parentBatchId,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!parentItem) return;

    const logs = await InventoryBatchLogs.findAll({
      attributes: ["user_id", "quantity_read", "inventory_batch_item_id"],
      where: { inventory_batch_item_id: [childItem.id, parentItem.id] },
      transaction: t,
    });

    // Soma por conferente em cada lote: { userId: { child, parent } }
    const totalsByUser = new Map<string, { child: number; parent: number }>();
    for (const log of logs) {
      const totals = totalsByUser.get(log.user_id) ?? { child: 0, parent: 0 };
      if (log.inventory_batch_item_id === childItem.id) {
        totals.child += Number(log.quantity_read);
      } else {
        totals.parent += Number(log.quantity_read);
      }
      totalsByUser.set(log.user_id, totals);
    }

    // Só quem recontou no lote de divergência é ajustado no pai
    const childUserIds = new Set(
      logs
        .filter((log) => log.inventory_batch_item_id === childItem.id)
        .map((log) => log.user_id),
    );
    const deltaLogs = [...childUserIds]
      .map((userId) => {
        const totals = totalsByUser.get(userId)!;
        return { userId, delta: totals.child - totals.parent };
      })
      .filter(({ delta }) => delta !== 0)
      .map(({ userId, delta }) => ({
        user_id: userId,
        quantity_read: delta,
        label_code: "DIVERGENCY_RECOUNT",
        inventory_batch_item_id: parentItem.id,
        date: new Date(),
      }));
    if (!deltaLogs.length) return;

    await InventoryBatchLogs.bulkCreate(deltaLogs, { transaction: t });

    await this.syncItemAndBatchAfterScan(
      parentItem.id,
      parentBatchId,
      deltaLogs[0].user_id,
      "REGULAR",
      t,
      { skipInitialDivergency: true, unitPrice },
    );
  }
}
export default new InventoryBatchLogsRepository();
