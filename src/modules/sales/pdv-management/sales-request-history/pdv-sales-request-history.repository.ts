import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import PdvSalesRequestHistory from "./pdv-sales-request-history.model";

export class PdvSalesRequestHistoryRepository extends BaseRepository<PdvSalesRequestHistory> {
  constructor() {
    super(PdvSalesRequestHistory);
  }
}

export default new PdvSalesRequestHistoryRepository();
