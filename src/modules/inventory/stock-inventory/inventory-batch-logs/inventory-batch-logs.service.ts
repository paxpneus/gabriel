import { Op } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Product from "../../products/product.model";
import { ProductWithStock } from "../../products/product.types";
import Stock from "../../stock/stock.model";
import InventoryBatchItems from "../inventory-batch-items/inventory-batch-items.model";
import InventoryBatch from "../inventory-batch/inventory-batch.model";
import InventoryBatchLogs from "./inventory-batch-logs.model";
import inventoryBatchLogsRepository, {
  InventoryBatchLogsRepository,
} from "./inventory-batch-logs.repository";

export class InventoryBatchLogsService extends BaseService<
  InventoryBatchLogs,
  InventoryBatchLogsRepository
> {
  constructor() {
    super(inventoryBatchLogsRepository);
  }

  async scanProduct(
    unitBusinessId: string,
    productcode: string,
    inventoryBatchId: string,
    userId: string,
    quantity: number,
  ) {
    return await sequelize.transaction(async (t) => {
      if (!unitBusinessId) throw new Error("Loja do usuário não encontrada");
      if (!productcode) throw new Error("Código do produto não informado");
      if (!inventoryBatchId)
        throw new Error("Lote de Inventário não informado [ERRO DO SISTEMA]");

      const inventoryBatch = await InventoryBatch.findByPk(inventoryBatchId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!inventoryBatch) throw new Error("Lote de Inventário não encontrado");

      const existingUserIds = await InventoryBatchLogs.findAll({
        attributes: ["user_id"],
        where: {
          inventory_batch_item_id: {
            [Op.in]: sequelize.literal(
              `(SELECT id FROM inventory_batch_items WHERE inventory_batch_id = '${inventoryBatchId}')`,
            ),
          },
        },
        group: ["user_id"],
        transaction: t,
      });

      const uniqueUserIds = existingUserIds.map((l) => l.user_id);
      const isNewUser = !uniqueUserIds.includes(userId);

      if (isNewUser && uniqueUserIds.length >= 2) {
        throw new Error(
          "Este lote já possui 2 usuários em conferência. Não é permitido adicionar mais conferentes.",
        );
      }

      const productFound = (await Product.findOne({
        where: {
          [Op.or]: [{ ean: productcode }, { ean_tribut: productcode }],
        },
        include: [
          {
            model: Stock,
            as: "stocks",
            where: { unit_business_id: unitBusinessId },
          },
        ],
        transaction: t,
      })) as ProductWithStock;

      if (!productFound?.stocks?.length) {
        throw new Error("Produto não encontrado no estoque da loja");
      }

      const stock = productFound.stocks[0];

      let inventoryBatchItem = await InventoryBatchItems.findOne({
        where: {
          product_id: productFound.id,
          inventory_batch_id: inventoryBatchId,
          stock_id: stock.id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!inventoryBatchItem) {
        inventoryBatchItem = await InventoryBatchItems.create(
          {
            product_id: productFound.id,
            inventory_batch_id: inventoryBatchId,
            ean: productFound.ean,
            sku: productFound.sku,
            quantity_stock: stock.quantity,
            quantity_read: 0,
            divergency: stock.quantity,
            stock_id: stock.id!,
            status: "PENDING",
          },
          { transaction: t },
        );

        await InventoryBatch.increment("total_quantity_stock", {
          by: stock.quantity,
          where: { id: inventoryBatchId },
          transaction: t,
        });
      }

      const existingLog = await InventoryBatchLogs.findOne({
        where: {
          user_id: userId,
          inventory_batch_item_id: inventoryBatchItem.id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const previousUserRead = existingLog
        ? Number(existingLog.quantity_read)
        : 0;

      if (existingLog) {
        await existingLog.increment("quantity_read", {
          by: quantity,
          transaction: t,
        });
      } else {
        await InventoryBatchLogs.create(
          {
            user_id: userId,
            quantity_read: quantity,
            label_code: productcode,
            inventory_batch_item_id: inventoryBatchItem.id,
            date: new Date(),
          },
          { transaction: t },
        );
        await InventoryBatchItems.update(
          { status: "PENDING" },
          { where: { id: inventoryBatchItem.id }, transaction: t },
        );
      }

      const newUserRead = previousUserRead + quantity;

      const maxOtherLog = await InventoryBatchLogs.findOne({
        where: {
          inventory_batch_item_id: inventoryBatchItem.id,
          user_id: { [Op.ne]: userId },
        },
        order: [["quantity_read", "DESC"]],
        transaction: t,
      });

      const maxOtherRead = maxOtherLog ? Number(maxOtherLog.quantity_read) : 0;
      const newItemQuantityRead = Math.max(newUserRead, maxOtherRead);
      const previousItemQuantityRead = Number(inventoryBatchItem.quantity_read);
      const itemDelta = newItemQuantityRead - previousItemQuantityRead;

      await InventoryBatchItems.update(
        {
          quantity_read: newItemQuantityRead,
          divergency:
            Number(inventoryBatchItem.quantity_stock) - newItemQuantityRead,
        },
        {
          where: { id: inventoryBatchItem.id },
          transaction: t,
        },
      );

      if (itemDelta > 0) {
        await InventoryBatch.increment("total_quantity_read", {
          by: itemDelta,
          where: { id: inventoryBatchId },
          transaction: t,
        });
      }

      const scanLogs = await InventoryBatchLogs.findAll({
        where: {
          inventory_batch_item_id: inventoryBatchItem.id,
        },
        transaction: t,
      });

      const updatedItem = await InventoryBatchItems.findByPk(
        inventoryBatchItem.id,
        { transaction: t },
      );

      const allRead = scanLogs.every(
        (s) => Number(s.quantity_read) >= Number(updatedItem!.quantity_stock),
      );

      const userDivergency =
        scanLogs.length === 2
          ? Math.abs(
              Number(scanLogs[0].quantity_read) -
                Number(scanLogs[1].quantity_read),
            )
          : 0;

      const hasUserDivergency = userDivergency > 0;

      const anyUserReadEnough = scanLogs.some(
        (s) => Number(s.quantity_read) >= Number(updatedItem!.quantity_stock),
      );

      const newStatus =
        !hasUserDivergency && anyUserReadEnough ? "FINISHED" : "PENDING";

      if (newStatus) {
        await updatedItem!.update({ status: newStatus }, { transaction: t });
      }

      const allBatchItems = await InventoryBatchItems.findAll({
        where: { inventory_batch_id: inventoryBatchId },
        transaction: t,
      });

      const allItemsFinished = allBatchItems.every(
        (i) => i.status === "FINISHED",
      );

      await InventoryBatch.update(
        { status: allItemsFinished ? "FINISHED" : "PENDING" },
        { where: { id: inventoryBatchId }, transaction: t },
      );

      if (
        inventoryBatch.type === "DIVERGENCY" &&
        inventoryBatch.BatchIdForDivergency &&
        newStatus === "FINISHED"
      ) {
        const parentBatchItem = await InventoryBatchItems.findOne({
          where: {
            ean: productcode,
            inventory_batch_id: inventoryBatch.BatchIdForDivergency,
            stock_id: stock.id,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (parentBatchItem) {
          const existingParentLog = await InventoryBatchLogs.findOne({
            where: {
              user_id: userId,
              inventory_batch_item_id: parentBatchItem.id,
            },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          const previousParentUserRead = existingParentLog
            ? Number(existingParentLog.quantity_read)
            : 0;

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
                inventory_batch_item_id: parentBatchItem.id,
                date: new Date(),
              },
              { transaction: t },
            );
          }

          const maxOtherParentLog = await InventoryBatchLogs.findOne({
            where: {
              inventory_batch_item_id: parentBatchItem.id,
              user_id: { [Op.ne]: userId },
            },
            order: [["quantity_read", "DESC"]],
            transaction: t,
          });

          const maxOtherParentRead = maxOtherParentLog
            ? Number(maxOtherParentLog.quantity_read)
            : 0;

          const newParentItemRead = Math.max(newUserRead, maxOtherParentRead);
          const previousParentItemRead = Number(parentBatchItem.quantity_read);
          const parentDelta = newParentItemRead - previousParentItemRead;

          await InventoryBatchItems.update(
            {
              quantity_read: newParentItemRead,
              divergency:
                Number(parentBatchItem.quantity_stock) - newParentItemRead,
            },
            { where: { id: parentBatchItem.id }, transaction: t },
          );

          if (parentDelta !== 0) {
            await InventoryBatch.increment("total_quantity_read", {
              by: parentDelta,
              where: { id: inventoryBatch.BatchIdForDivergency },
              transaction: t,
            });
          }

          const parentLogs = await InventoryBatchLogs.findAll({
            where: { inventory_batch_item_id: parentBatchItem.id },
            transaction: t,
          });

          const updatedParentItem = await InventoryBatchItems.findByPk(
            parentBatchItem.id,
            { transaction: t },
          );

          const parentAllRead = parentLogs.every(
            (l) =>
              Number(l.quantity_read) >=
              Number(updatedParentItem!.quantity_stock),
          );

          const parentUserDivergency =
            parentLogs.length === 2
              ? Math.abs(
                  Number(parentLogs[0].quantity_read) -
                    Number(parentLogs[1].quantity_read),
                )
              : 0;

          const parentHasUserDivergency = parentUserDivergency > 0;

          const parentAnyUserReadEnough = parentLogs.some(
            (l) =>
              Number(l.quantity_read) >=
              Number(updatedParentItem!.quantity_stock),
          );

          const parentNewStatus =
            !parentHasUserDivergency && parentAnyUserReadEnough
              ? "FINISHED"
              : "PENDING";

          await updatedParentItem!.update(
            { status: parentNewStatus },
            { transaction: t },
          );

          if (parentNewStatus === "FINISHED") {
            const allParentItems = await InventoryBatchItems.findAll({
              where: {
                inventory_batch_id: inventoryBatch.BatchIdForDivergency!,
              },
              transaction: t,
            });

            const allParentItemsFinished = allParentItems.every(
              (i) => i.status === "FINISHED",
            );

            if (allParentItemsFinished) {
              await InventoryBatch.update(
                { status: "FINISHED" },
                {
                  where: { id: inventoryBatch.BatchIdForDivergency },
                  transaction: t,
                },
              );
            } else {
              await InventoryBatch.update(
                { status: "PENDING" },
                {
                  where: { id: inventoryBatch.BatchIdForDivergency },
                  transaction: t,
                },
              );
            }
          }
        }
      }

      return {
        product_id: productFound.id,
        product_name: productFound.name,
        ean: productFound.ean,
        ean_tribut: productFound.ean_tribut,
      };
    });
  }

  async updateLogQuantity(
    logId: string,
    userId: string,
    newQuantity: number,
  ): Promise<boolean> {
    return await sequelize.transaction(async (t) => {
      const log = await InventoryBatchLogs.findByPk(logId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!log) throw new Error("Log não encontrado");
      if (log.user_id !== userId)
        throw new Error("Sem permissão para editar este log");

      await log.update({ quantity_read: newQuantity }, { transaction: t });

      const inventoryBatchItem = await InventoryBatchItems.findByPk(
        log.inventory_batch_item_id,
        { transaction: t, lock: t.LOCK.UPDATE },
      );

      if (!inventoryBatchItem) throw new Error("Item do lote não encontrado");

      const inventoryBatch = await InventoryBatch.findByPk(
        inventoryBatchItem.inventory_batch_id,
        { transaction: t, lock: t.LOCK.UPDATE },
      );

      if (!inventoryBatch) throw new Error("Lote não encontrado");

      // Recalcula quantity_read do item como o max entre todos os logs
      const allLogs = await InventoryBatchLogs.findAll({
        where: { inventory_batch_item_id: inventoryBatchItem.id },
        transaction: t,
      });

      const previousItemRead = Number(inventoryBatchItem.quantity_read);
      const newItemRead = Math.max(
        ...allLogs.map((l) => Number(l.quantity_read)),
      );
      const itemDelta = newItemRead - previousItemRead;

      await inventoryBatchItem.update(
        {
          quantity_read: newItemRead,
          divergency: Number(inventoryBatchItem.quantity_stock) - newItemRead,
        },
        { transaction: t },
      );

      if (itemDelta !== 0) {
        await InventoryBatch.increment("total_quantity_read", {
          by: itemDelta,
          where: { id: inventoryBatch.id },
          transaction: t,
        });
      }

      // ─── Recalcula status do item ─────────────────────────────────────────────

      const hasTwoUsers = allLogs.length >= 2;

      const userDivergency = hasTwoUsers
        ? Math.abs(
            Number(allLogs[0].quantity_read) - Number(allLogs[1].quantity_read),
          )
        : null;

      const hasUserDivergency = userDivergency !== null && userDivergency > 0;

      const anyUserReadEnough = allLogs.some(
        (l) =>
          Number(l.quantity_read) >= Number(inventoryBatchItem.quantity_stock),
      );

      const newStatus =
        !hasUserDivergency && anyUserReadEnough ? "FINISHED" : "PENDING";

      await inventoryBatchItem.update(
        { status: newStatus },
        { transaction: t },
      );

      // ─── Recalcula status do batch ────────────────────────────────────────────

      if (newStatus === "FINISHED") {
        const allBatchItems = await InventoryBatchItems.findAll({
          where: { inventory_batch_id: inventoryBatch.id },
          transaction: t,
        });

        const allItemsFinished = allBatchItems.every(
          (i) => i.status === "FINISHED",
        );

        if (allItemsFinished) {
          await InventoryBatch.update(
            { status: "FINISHED" },
            { where: { id: inventoryBatch.id }, transaction: t },
          );
        }
      }

      return true;
    });
  }
}

export default new InventoryBatchLogsService();
