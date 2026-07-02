import BaseService from "../../../shared/utils/base-models/base-service";
import Brand from "./brands.model";
import brandRepository, { BrandRepository } from "./brands.repository";

export class BrandService extends BaseService<Brand, BrandRepository> {
  constructor() {
    super(brandRepository);

    this.queryConfig = {
      filterableFields: ["id"],
      sortableFields: [
        "name",
        "seller_comission_tax_rate",
        "manager_comission_tax_rate",
        "createdAt",
      ],
      searchFields: ["name"],
      defaults: {
        perPage: 20,
        sortBy: "name",
        sortDir: "ASC",
      },
    };
  }
}

export default new BrandService();
