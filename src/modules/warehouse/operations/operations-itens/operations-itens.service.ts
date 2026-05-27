import BaseService from "../../../../shared/utils/base-models/base-service";
import OperationsItens from "./operations-itens.model";
import operationsItensRepository, {
  OperationsItensRepository,
} from "./operations-itens.repository";

export class OperationsItensService extends BaseService<
  OperationsItens,
  OperationsItensRepository
> {
  constructor() {
    super(operationsItensRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      searchFields: ["code"],
      filterableFields: ["operation_id", "product_id"],
      sortableFields: ["quantity", "createdAt", "updatedAt"],
    };
  }
}

export default new OperationsItensService();
