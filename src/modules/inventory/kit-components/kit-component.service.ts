import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import KitComponent from "./kit-component.model";
import kitComponentRepository, {
  KitComponentRepository,
} from "./kit-component.repository";

export class KitComponentService extends BaseService<
  KitComponent,
  KitComponentRepository
> {
  constructor() {
    super(kitComponentRepository);

    this.queryConfig = {
      filterableFields: ["product_kit_id", "product_component_id"],
      sortableFields: ["quantity", "createdAt"],
      searchFields: [],
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
    };
  }

  async syncForKit(
    productKitId: string,
    components: Array<{ product_component_id: string; quantity: number }>,
    options?: { transaction?: Transaction },
  ): Promise<void> {
    return this.repository.syncForKit(productKitId, components, options);
  }
}

export default new KitComponentService();
