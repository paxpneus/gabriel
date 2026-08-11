import BaseService from "../../../../../../shared/utils/base-models/base-service";
import Cte from "../cte.model";
import cteRepository, { CteRepository } from "../cte.repository";

export class CteService extends BaseService<Cte, CteRepository> {
  constructor() {
    super(cteRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["number", "xml_key"],
      filterableFields: ["taker_tax_id", "receiver_tax_id", "sender_tax_id", "recipient_tax_id", "dispatcher_tax_id", "issue_date"],
      sortableFields: ["createdAt", "issue_date", "number"],
    };
  }
}

export default new CteService();
