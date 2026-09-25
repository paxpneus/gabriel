import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import PdvSalesRequestHistory from "./pdv-sales-request-history.model";

export class PdvSalesRequestHistoryRepository extends BaseRepository<PdvSalesRequestHistory> {
  constructor() {
    super(PdvSalesRequestHistory);
  }

  async deleteAllByRequestId(requestId: string): Promise<number> {
    return this.model.destroy({ where: { pdv_sales_request_id: requestId } });
  }
}

export default new PdvSalesRequestHistoryRepository();
