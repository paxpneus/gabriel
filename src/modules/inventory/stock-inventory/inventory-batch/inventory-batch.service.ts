import BaseService from "../../../../shared/utils/base-models/base-service";
import InventoryBatch from "./inventory-batch.model";
import inventoryBatchRepository, {
  InventoryBatchRepository,
} from "./inventory-batch.repository";
import InventoryBatchItems from "../inventory-batch-items/inventory-batch-items.model";
import InventoryBatchLogs from "../inventory-batch-logs/inventory-batch-logs.model";
import sequelize from "../../../../config/sequelize";
import { Product, Stock } from "../../../inventory";
import User from "../../../warehouse/users/users/user.model";
import { setBatchNumber } from "../../../../shared/utils/normalizers/batch-nomenclature";
import { UnitBusiness } from "../../../warehouse";
import { FindOptions } from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import { ProductWithStock } from "../../products/product.types";
import { InventoryBatchItemsCreationAttributes } from "../inventory-batch-items/inventory-batch-items.types";

export class InventoryBatchService extends BaseService<
  InventoryBatch,
  InventoryBatchRepository
> {
  constructor() {
    super(inventoryBatchRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["number"],
      filterableFields: [
        "unit_business_id",
        "status",
        "type",
        "BatchIdForDivergency",
        "mode",
      ],
      sortableFields: ["number", "createdAt", "status", "updatedAt"],
    };
  }

  private calculateDivergencyTotals(items: any[] = []) {
    return items.reduce(
      (
        totals: { total_entries: number; total_outputs: number },
        item: any,
      ) => {
        const divergency = Number(item.divergency ?? 0);
        const productPrice = Number(item.product?.price ?? item.price ?? 0);
        const divergencyValue = divergency * productPrice;

        if (divergency < 0) {
          totals.total_entries += divergencyValue;
        }

        if (divergency > 0) {
          totals.total_outputs += divergencyValue;
        }

        return totals;
      },
      { total_entries: 0, total_outputs: 0 },
    );
  }

  async createInventoryBatch(
    unitBusinessId: string,
    mode: string,
  ): Promise<InventoryBatch> {
    let batchId: string;

    await sequelize.transaction(async (t) => {
      const unitBusiness = await UnitBusiness.findOne({
        where: { id: unitBusinessId },
      });

      const batch = await InventoryBatch.create(
        {
          number: await setBatchNumber(
            "INVENTORY",
            unitBusiness?.number!,
            unitBusinessId,
          ),
          date: new Date(),
          total_quantity_stock: 0,
          total_quantity_read: 0,
          unit_business_id: unitBusinessId,
          status: "OPEN",
          type: "REGULAR",
          mode,
        },
        { transaction: t },
      );

      batchId = batch.id;

      if (mode == "FIXED") {
        let totalPrice: number;
        let totalQuantity: number;

        // Pega todos produtos que tem estoque na unidade escolhida
        const products = (await Product.findAll({
          where: {
            type: "UNIT",
          },
          include: [
            {
              model: Stock,
              as: "stocks",
              required: true,
              where: {
                unit_business_id: unitBusinessId,
              },
            },
          ],
        })) as ProductWithStock[];

        const payloadBatchItem: InventoryBatchItemsCreationAttributes[] =
          products.map((p) => {
            const stock = p.stocks[0];

            if (!stock) {
              throw new Error(`Produto ${p.id} sem estoque`);
            }

            return {
              product_id: p.id,
              inventory_batch_id: batch.id,
              ean: p.ean_tribut ?? p.ean ?? '',
              sku: p.sku ?? "",
              quantity_stock: stock.quantity,
              status: "OPEN",
              stock_id: stock.id,
              price: stock.total_price,
              divergency: 0,
              initial_divergency: 0,
              quantity_read: 0,
            };
          });

        totalQuantity = payloadBatchItem.reduce((acc, item) => {
          return acc + item.quantity_stock;
        }, 0);

        totalPrice = payloadBatchItem.reduce((acc, item) => {
          return acc + (item.price ?? 0);
        }, 0);

        await InventoryBatchItems.bulkCreate(payloadBatchItem, {
          transaction: t,
        });

        await batch.update(
          {
            total_price: totalPrice,
            total_quantity_stock: totalQuantity,
          },
          { transaction: t },
        );
      }
    });

    return (await this.findByIdFullBatch(batchId!)) as InventoryBatch;
  }

  async createDivergencyBatch(parentBatchId: string): Promise<InventoryBatch> {
    let newBatchId: string;

    await sequelize.transaction(async (t) => {
      const parentBatch = await InventoryBatch.findByPk(parentBatchId, {
        transaction: t,
      });

      if (!parentBatch) throw new Error("Lote pai não encontrado");
      if (parentBatch.type !== "REGULAR")
        throw new Error("Lote pai deve ser do tipo NORMAL");

      const unitBusiness = await UnitBusiness.findOne({
        where: { id: parentBatch.unit_business_id },
      });

      if (!unitBusiness) throw new Error("UnitBusiness não encontrada");

      // 2. Busca todos os items do lote pai com seus logs
      const parentItems = await InventoryBatchItems.findAll({
        where: { inventory_batch_id: parentBatchId },
        include: [
          {
            model: InventoryBatchLogs,
            as: "logs",
          },
        ],
        transaction: t,
      });

      // 3. Filtra somente os itens onde os usuários divergiram entre si
      const divergentItems = parentItems.filter((item) => {
        const logs = (item as any).logs ?? [];

        // precisa ter pelo menos 2 logs (2 usuários) para haver divergência entre eles
        if (logs.length < 2) return false;

        const quantities = logs.map((l: any) => Number(l.quantity_read));
        const min = Math.min(...quantities);
        const max = Math.max(...quantities);

        return max !== min;
      });

      if (!divergentItems.length) {
        throw new Error(
          "Nenhuma divergência encontrada entre os usuários neste lote",
        );
      }

      // 4. Cria o novo lote de divergência
      const newBatch = await InventoryBatch.create(
        {
          number: await setBatchNumber(
            "DIVERGENCY",
            unitBusiness.number!,
            parentBatch.unit_business_id,
          ),
          date: new Date(),
          total_quantity_stock: 0,
          total_quantity_read: 0,
          unit_business_id: parentBatch.unit_business_id,
          status: "OPEN",
          type: "DIVERGENCY",
          mode: parentBatch.mode,
          BatchIdForDivergency: parentBatchId,
        },
        { transaction: t },
      );

      newBatchId = newBatch.id;

      // 5. Cria os batch items do lote de divergência
      // quantity_stock = maior leitura entre os usuários (referência para recontar)
      let totalStock = 0;

      for (const item of divergentItems) {
        await InventoryBatchItems.create(
          {
            product_id: item.product_id,
            inventory_batch_id: newBatch.id,
            ean: item.ean,
            sku: item.sku,
            quantity_stock: item.quantity_stock,
            quantity_read: 0,
            divergency: item.quantity_stock,
            stock_id: item.stock_id,
            status: "OPEN",
          },
          { transaction: t },
        );

        totalStock += Number(item.quantity_stock);
      }

      await newBatch.update(
        { total_quantity_stock: totalStock },
        { transaction: t },
      );
    });

    return (await this.findByIdFullBatch(newBatchId!)) as InventoryBatch;
  }

  async finishBatch(
    batchId: string,
  ): Promise<{ success: boolean; message: string }> {
    return await sequelize.transaction(async (t) => {
      const batch = await InventoryBatch.findByPk(batchId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote de inventário não encontrado");
      if (batch.status === "FINISHED")
        throw new Error("Lote já foi finalizado");

      const items = await InventoryBatchItems.findAll({
        where: { inventory_batch_id: batchId },
        transaction: t,
      });

      if (!items.length) {
        throw new Error("Nenhum produto foi lido neste lote");
      }

      const pendingItems = items.filter((i) => i.status !== "FINISHED");

      if (pendingItems.length > 0) {
        throw new Error(
          `Não é possível concluir: ${pendingItems.length} produto(s) ainda não foram conferidos por todos os usuários`,
        );
      }

      await batch.update({ status: "FINISHED" }, { transaction: t });

      return { success: true, message: "Lote finalizado com sucesso" };
    });
  }

  async findByIdFullBatch(
    batchId?: string,
    number?: string,
    userId?: string,
  ): Promise<InventoryBatch> {
    const whereClause: any = {};
    if (batchId) whereClause.id = batchId;
    if (number) whereClause.number = number;

    if (userId) {
      const batch = await InventoryBatch.findOne({
        where: whereClause,
        include: [
          {
            model: InventoryBatchItems,
            as: "items",
            include: [
              {
                model: Product,
                as: "product",
                attributes: ["id", "name", "ean", "sku", "type", "price"],
              },
              {
                model: Stock,
                as: "stock",
              },
              {
                model: InventoryBatchLogs,
                as: "logs",
                where: { user_id: userId },
                required: false,
              },
            ],
          },
        ],
      });

      if (!batch) throw new Error("Lote de inventário não encontrado");

      const batchJson = batch.toJSON() as any;
      batchJson.items = batchJson.items.map((item: any) => {
        const userRead = (item.logs ?? []).reduce(
          (acc: number, log: any) => acc + Number(log.quantity_read),
          0,
        );
        return {
          ...item,
          quantity_read: userRead,
          divergency: Number(item.quantity_stock) - userRead,
          quantity_read_by_user: userRead,
        };
      });

      Object.assign(
        batchJson,
        this.calculateDivergencyTotals(batchJson.items),
      );

      return batchJson;
    }

    const batch = await InventoryBatch.findOne({
      where: whereClause,
      include: [
        {
          model: InventoryBatchItems,
          as: "items",
          include: [
            {
              model: Product,
              as: "product",
              attributes: ["id", "name", "ean", "sku", "price"],
            },
            {
              model: Stock,
              as: "stock",
            },
            {
              model: InventoryBatchLogs,
              as: "logs",
              include: [
                {
                  model: User,
                  as: "user",
                  attributes: ["id", "name"],
                },
              ],
            },
          ],
        },
      ],
    });

    if (!batch) throw new Error("Lote de inventário não encontrado");

    const batchJson = batch.toJSON() as any;
    Object.assign(batchJson, this.calculateDivergencyTotals(batchJson.items));

    return batchJson;
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<InventoryBatch>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: UnitBusiness,
          as: "unitBusiness",
        },
      ],
    });
  }
}

export default new InventoryBatchService();
