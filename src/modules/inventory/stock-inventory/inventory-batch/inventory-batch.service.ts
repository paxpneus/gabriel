import BaseService from "../../../../shared/utils/base-models/base-service";
import InventoryBatch from "./inventory-batch.model";
import inventoryBatchRepository, {
  InventoryBatchRepository,
} from "./inventory-batch.repository";
import InventoryBatchItems from "../inventory-batch-items/inventory-batch-items.model";
import sequelize from "../../../../config/sequelize";
import { Product, Stock } from "../../../inventory";

export class InventoryBatchService extends BaseService<
  InventoryBatch,
  InventoryBatchRepository
> {
  constructor() {
    super(inventoryBatchRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      searchFields: ["number"],
      filterableFields: ["unit_business_id"],
      sortableFields: ["number", "createdAt", "updatedAt"],
    };
  }

  async createInventoryBatch(
    unitBusinessId: string,
  ): Promise<InventoryBatch> {
    let batchId: string;

    await sequelize.transaction(async (t) => {
      

      const batchNumber = `INV-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;

   

      const batch = await InventoryBatch.create(
        {
          number: batchNumber,
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


  async findByIdFullBatch(
    batchId?: string,
    number?: string
  ): Promise<InventoryBatch> {
    const whereClause: any = {};
    if (batchId) whereClause.id = batchId;
    if (number) whereClause.number = number;

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