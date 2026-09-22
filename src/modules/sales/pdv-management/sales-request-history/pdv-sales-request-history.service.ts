import { DestroyOptions } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import PdvSalesRequestHistory from "./pdv-sales-request-history.model";
import pdvSalesRequestHistoryRepository, {
  PdvSalesRequestHistoryRepository,
} from "./pdv-sales-request-history.repository";

export class PdvSalesRequestHistoryService extends BaseService<
  PdvSalesRequestHistory,
  PdvSalesRequestHistoryRepository
> {
  constructor() {
    super(pdvSalesRequestHistoryRepository);

    this.queryConfig = {
      defaults: { perPage: 100, sortBy: "date", sortDir: "ASC" },
    };
  }

  // Histórico nunca é apagado por ação de negócio — só some junto da
  // solicitação (onDelete: CASCADE no banco, fora da service layer). Sem
  // controller/rotas próprias hoje, então isso só protege contra uma chamada
  // futura por engano vindo de PdvSalesRequestService.
  async delete(_id: string): Promise<boolean> {
    throw new Error(
      "Histórico da solicitação não pode ser excluído diretamente — só via exclusão em cascata da própria solicitação",
    );
  }

  async bulkDelete(_options: DestroyOptions): Promise<number> {
    throw new Error(
      "Histórico da solicitação não pode ser excluído diretamente — só via exclusão em cascata da própria solicitação",
    );
  }
}

export default new PdvSalesRequestHistoryService();
