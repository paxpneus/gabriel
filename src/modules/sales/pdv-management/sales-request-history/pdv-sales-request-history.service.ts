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
}

export default new PdvSalesRequestHistoryService();
