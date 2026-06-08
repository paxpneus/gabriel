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
import inventoryBatchItemsRepository from "../inventory-batch-items/inventory-batch-items.repository";
import ProductConfig from "../../product-config/product_config.model";

export class InventoryBatchLogsService extends BaseService<
  InventoryBatchLogs,
  InventoryBatchLogsRepository
> {
  constructor() {
    super(inventoryBatchLogsRepository);
  }

  // inventory-batch-logs.service.ts

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

      // ── 1. Valida batch ───────────────────────────────────────────────────────
      const inventoryBatch = await InventoryBatch.findByPk(inventoryBatchId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!inventoryBatch) throw new Error("Lote de Inventário não encontrado");

      // ── 2. Valida limite de 2 usuários por batch ───────────────────────────────
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

      // ── 3. Busca produto + stock ──────────────────────────────────────────────
      const productFound = (await Product.findOne({
        where: { [Op.or]: [{ ean: productcode }, { ean_tribut: productcode }] },
        include: [
          {
            model: Stock,
            as: "stocks",
            where: { unit_business_id: unitBusinessId },
          },
          {
            model: ProductConfig,
            as: "productConfigs",
            required: false,
            where: { unit_business_id: unitBusinessId },
          },
        ],
        transaction: t,
      })) as ProductWithStock;

      if (!productFound?.stocks?.length)
        throw new Error("Produto não encontrado no estoque da loja");
      const stock = productFound.stocks[0];
      const config = (productFound as any).productConfigs?.[0];

      // ── 4. Upsert do batch item (centralizado) ────────────────────────────────
      const inventoryBatchItem = await inventoryBatchItemsRepository.upsertItem(
        {
          batchId: inventoryBatchId,
          productId: productFound.id,
          stockId: stock.id!,
          ean: productFound.ean ?? "",
          sku: config?.sku ?? "",
          quantityStock: stock.quantity,
        },
        t,
      );

      // ── 5. Cria ou incrementa o log do usuário ────────────────────────────────
      const existingLog = await InventoryBatchLogs.findOne({
        where: {
          user_id: userId,
          inventory_batch_item_id: inventoryBatchItem.id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

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
      }

      // ── 6. Sincroniza item + batch após leitura (centralizado) ────────────────
      await inventoryBatchLogsRepository.syncItemAndBatchAfterScan(
        inventoryBatchItem.id,
        inventoryBatchId,
        userId,
        inventoryBatch.type,
        t,
        { unitPrice: config?.price ?? 0 },
      );

      // ── 7. Propaga para batch pai se for DIVERGENCY ───────────────────────────
      if (
        inventoryBatch.type === "DIVERGENCY" &&
        inventoryBatch.BatchIdForDivergency
      ) {
        await inventoryBatchLogsRepository.syncDivergencyParent(
          {
            parentBatchId: inventoryBatch.BatchIdForDivergency,
            productcode,
            stockId: stock.id!,
            userId,
            itemId: inventoryBatchItem.id,
          },
          t,
        );
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

      await inventoryBatchItem.update(
        {
          quantity_read: newItemRead,
          divergency: Number(inventoryBatchItem.quantity_stock) - newItemRead,
          ...(inventoryBatch.type === "REGULAR" && {
            initial_divergency: userDivergency ?? 0,
          }),
        },
        { transaction: t },
      );

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
