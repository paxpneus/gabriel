import BaseService from "../../../../shared/utils/base-models/base-service";
import InventoryBatch from "./inventory-batch.model";
import inventoryBatchRepository, {
  InventoryBatchRepository,
} from "./inventory-batch.repository";
import InventoryBatchItems from "../inventory-batch-items/inventory-batch-items.model";
import InventoryBatchLogs from "../inventory-batch-logs/inventory-batch-logs.model";
import sequelize from "../../../../config/sequelize";
import { Product } from "../../../inventory";
import User from "../../../warehouse/users/users/user.model";
import { setBatchNumber } from "../../../../shared/utils/normalizers/batch-nomenclature";
import { UnitBusiness } from "../../../warehouse";
import { FindOptions } from "sequelize";
import { PaginatedResult, QueryParams } from "../../../../shared/query/query.types";

export class InventoryBatchService extends BaseService<
  InventoryBatch,
  InventoryBatchRepository
> {
  constructor() {
    super(inventoryBatchRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["number"],
      filterableFields: ["unit_business_id"],
      sortableFields: ["number", "createdAt", "updatedAt"],
    };
  }

  async createInventoryBatch(unitBusinessId: string): Promise<InventoryBatch> {
    let batchId: string;

    await sequelize.transaction(async (t) => {
      const unitBusiness = await UnitBusiness.findOne({
        where: { id: unitBusinessId },
      });

      const batch = await InventoryBatch.create(
        {
          number: await setBatchNumber("INVENTORY", unitBusiness?.number!, unitBusinessId),
          date: new Date(),
          total_quantity_stock: 0,
          total_quantity_read: 0,
          unit_business_id: unitBusinessId,
          status: "OPEN",
        },
        { transaction: t }
      );

      batchId = batch.id;
    });

    return (await this.findByIdFullBatch(batchId!)) as InventoryBatch;
  }

  async finishBatch(batchId: string): Promise<{ success: boolean; message: string }> {
    return await sequelize.transaction(async (t) => {
      const batch = await InventoryBatch.findByPk(batchId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote de inventário não encontrado");
      if (batch.status === "FINISHED") throw new Error("Lote já foi finalizado");

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
          `Não é possível concluir: ${pendingItems.length} produto(s) ainda não foram conferidos por todos os usuários`
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
                attributes: ["id", "name", "ean", "sku"],
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
              attributes: ["id", "name", "ean", "sku"],
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

    return batch;
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
        }
      ]
    })
  }
}

export default new InventoryBatchService();