import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import OperationsItens from "../operations-itens/operations-itens.model";
import Operations from "./operations.model";
import operationsRepository, {
  OperationsRepository,
} from "./operations.repository";
import { CreateOperationItemDTO } from "./operations.types";
import { CreateOptions } from "sequelize";

export class OperationsService extends BaseService<
  Operations,
  OperationsRepository
> {
  constructor() {
    super(operationsRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      searchFields: ["description", "transporter_name"],
      filterableFields: ["status", "invoice_id", "from_unit", "to_unit"],
      sortableFields: [
        "date",
        "due_at",
        "expected_at",
        "status",
        "createdAt",
        "updatedAt",
      ],
    };
  }

  async create(
    data: Partial<Operations["_creationAttributes"]> & {
      items?: CreateOperationItemDTO[];
    },
    options?: CreateOptions,
  ): Promise<Operations> {
    if (options?.transaction) {
      const { items = [], ...operationPayload } = data;
      const totalQuantity =
        operationPayload.total_quantity ??
        items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);

      const operation = await this.repository.create(
        {
          ...operationPayload,
          total_quantity: totalQuantity,
        },
        options,
      );

      if (items.length) {
        await OperationsItens.bulkCreate(
          items.map((item) => ({
            ...item,
            operation_id: operation.id,
          })),
          { transaction: options.transaction },
        );
      }

      return operation;
    }

    return sequelize.transaction(async (transaction) => {
      const { items = [], ...operationPayload } = data;
      const totalQuantity =
        operationPayload.total_quantity ??
        items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);

      const operation = await this.repository.create(
        {
          ...operationPayload,
          total_quantity: totalQuantity,
        },
        { transaction },
      );

      if (items.length) {
        await OperationsItens.bulkCreate(
          items.map((item) => ({
            ...item,
            operation_id: operation.id,
          })),
          { transaction },
        );
      }

      return (await this.repository.findByIdWithRelations(operation.id)) ?? operation;
    });
  }

  findByIdFull(id: string) {
    return this.repository.findByIdWithRelations(id);
  }
}

export default new OperationsService();
