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
  ) {
    return await sequelize.transaction(async (t) => {
      if (!unitBusinessId) throw new Error("Loja do usuário não encontrada");
      if (!productcode) throw new Error("Código do produto não informado");
      if (!inventoryBatchId)
        throw new Error("Lote de Inventário não informado [ERRO DO SISTEMA]");

      // 1. Valida o lote
      const inventoryBatch = await InventoryBatch.findByPk(inventoryBatchId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!inventoryBatch) throw new Error("Lote de Inventário não encontrado");

      // 2. Busca o produto com estoque da unidade
      const productFound = (await Product.findOne({
        where: { ean: productcode },
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

      // 3. Busca ou cria o inventory_batch_item (1 por produto × lote)
      let inventoryBatchItem = await InventoryBatchItems.findOne({
        where: {
          ean: productcode,
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

        // Incrementa total_quantity_stock do lote apenas na primeira vez que o produto aparece
        await InventoryBatch.increment("total_quantity_stock", {
          by: stock.quantity,
          where: { id: inventoryBatchId },
          transaction: t,
        });
      }

      // 4. Upsert no log — 1 registro por (usuário × item)
      //    Se já existe: incrementa quantity_read
      //    Se não existe: cria com quantity_read = 1
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
        await existingLog.increment("quantity_read", { by: 1, transaction: t });
      } else {
        await InventoryBatchLogs.create(
          {
            user_id: userId,
            quantity_read: 1,
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

      const newUserRead = previousUserRead + 1;

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
      // 6. Atualiza total geral do lote
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
        {
          transaction: t,
        },
      );

      const allRead = scanLogs.every(
        (s) => Number(s.quantity_read) >= Number(updatedItem!.quantity_stock),
      );

      if (allRead) {
        await updatedItem!.update({ status: "FINISHED" }, { transaction: t });
      }

      return true;
    });
  }
}

export default new InventoryBatchLogsService();
