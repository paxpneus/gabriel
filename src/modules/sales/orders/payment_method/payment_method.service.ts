import { Op } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { QueryParams } from "../../../../shared/query/query.types";
import PaymentMethod from "./payment_method.model";
import paymentMethodRepository, {
  PaymentMethodRepository,
} from "./payment_method.repository";

export class PaymentMethodService extends BaseService<
  PaymentMethod,
  PaymentMethodRepository
> {
  constructor() {
    super(paymentMethodRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "description", sortDir: "ASC" },
      searchFields: ["description"],
      sortableFields: ["description", "createdAt"],
    };
  }

  findLightByIds(ids: string[]) {
    return this.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ["id", "description"],
    });
  }

  findLightCatalog() {
    return this.findAll({ attributes: ["id", "description"] });
  }

  paginateList(params: QueryParams) {
    return this.paginate(params, {
      attributes: ["id", "id_system", "description", "payment_type"],
    });
  }
}

export default new PaymentMethodService();
