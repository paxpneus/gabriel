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
          where: {
            id: unitBusinessId
          }
        })

      const batch = await InventoryBatch.create(
        {
          number: await setBatchNumber('INVENTORY', unitBusiness?.id!, unitBusinessId),
          date: new Date(),
          total_quantity_stock: 0,
          total_quantity_read: 0,
          unit_business_id: unitBusinessId,
        },
        { transaction: t }
      );

      batchId = batch.id;
    });

    return (await this.findByIdFullBatch(batchId!)) as InventoryBatch;
  }

  /**
   * Retorna o lote com itens e leituras.
   *
   * COM userId  → usado pelo coletor:
   *   Cada item recebe `quantity_read` = o que aquele usuário leu (via seu log).
   *   Produtos que o usuário ainda não leu aparecem com quantity_read = 0,
   *   permitindo que o coletor veja o que ainda falta contar.
   *
   * SEM userId  → usado pelo relatório/comparação:
   *   Cada item traz `logs` com 1 entrada por usuário participante,
   *   cada uma com { user: { name }, quantity_read }.
   */
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

    // ── modo relatório: todos os logs agrupados por usuário 
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
}

export default new InventoryBatchService();