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
    if (!unitBusinessId) {
      throw new Error(`Loja do usuário não encontrada`);
    }

    if (!productcode) {
      throw new Error(`Código do produto não informado`);
    }

    if (!inventoryBatchId) {
      throw new Error(`Lote de Inventário não informado [ERRO DO SISTEMA]`);
    }

    const inventoryBatch = await InventoryBatch.findByPk(inventoryBatchId, {
      transaction: t,
    });

    if (!inventoryBatch) {
      throw new Error(`Lote de Inventário não encontrado`);
    }

    const productFound = (await Product.findOne({
      where: {
        ean: productcode,
      },
      include: [
        {
          model: Stock,
          as: "stock",
          where: {
            unit_business_id: unitBusinessId,
          },
        },
      ],
      transaction: t,
    })) as ProductWithStock;

    if (!productFound || !productFound.stock) {
      throw new Error(
        `Produto não encontrado no estoque da loja ou produto sem estoque`,
      );
    }

    let inventoryBatchItem = await InventoryBatchItems.findOne({
      where: {
        ean: productcode,
        inventory_batch_id: inventoryBatchId,
        stock_id: productFound.stock.id,
      },
      transaction: t,
    });

    if (!inventoryBatchItem) {
      inventoryBatchItem = await InventoryBatchItems.create(
        {
          product_id: productFound.id,
          inventory_batch_id: inventoryBatchId,
          ean: productFound.ean,
          sku: productFound.sku,
          quantity_stock: productFound.stock.quantity,
          quantity_read: 0,
          divergency: productFound.stock.quantity,
          stock_id: productFound.stock.id!,
          status: "PENDING",
        },
        { transaction: t },
      );

      await InventoryBatch.increment("total_quantity_stock", {
        by: productFound.stock.quantity,
        where: { id: inventoryBatchId },
        transaction: t,
      });
    }

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

    await InventoryBatchItems.increment("quantity_read", {
      by: 1,
      where: { id: inventoryBatchItem.id },
      transaction: t,
    });

    await InventoryBatchItems.increment("divergency", {
      by: -1,
      where: { id: inventoryBatchItem.id },
      transaction: t,
    });

    await InventoryBatch.increment("total_quantity_read", {
      by: 1,
      where: { id: inventoryBatchId },
      transaction: t,
    });

    return true;
  });
}
}

export default new InventoryBatchLogsService();
