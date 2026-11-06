import { Op } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { QueryParams } from "../../../../shared/query/query.types";
import PaymentMethod from "./payment_method.model";
import { CARD_BRANDS } from "../../../../shared/constants/card-brands";
import { MAX_INSTALLMENTS } from "../../../../shared/constants/installments";
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

  // Catálogo com os tipos de integração que cada método cobre (raw_payload.blingTypes) — base do auto-mapeamento.
  findCatalogWithIntegrationTypes() {
    return this.findAll({ attributes: ["id", "id_system", "raw_payload"] });
  }

  findLightCatalog() {
    return this.findAll({ attributes: ["id", "description"] });
  }

  // Bandeiras de cartão pro front (código = order_payments.card_brand); keywords são internas, não saem.
  listCardBrands(): { code: number; name: string }[] {
    return CARD_BRANDS.map(({ code, name }) => ({ code, name }));
  }

  // Opções de parcelas pro front (value = order_payments.installments).
  listInstallmentOptions(): { value: number; name: string }[] {
    return Array.from({ length: MAX_INSTALLMENTS }, (_, index) => ({
      value: index + 1,
      name: `${index + 1}x`,
    }));
  }

  paginateList(params: QueryParams) {
    return this.paginate(params, {
      attributes: ["id", "id_system", "description", "payment_type"],
    });
  }
}

export default new PaymentMethodService();
