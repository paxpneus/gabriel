import { Op, Sequelize } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Product from "../products/product.model";
import SupplierMapping from "./supplier-mapping.model";
import { FullSupplierMapping } from "./supplier-mapping.types";

export class SupplierMappingRepository extends BaseRepository<SupplierMapping> {
  constructor() {
    super(SupplierMapping);
  }

 async findSupplierByProductCode(
  ean: string,
  integrationsId: string,
): Promise<FullSupplierMapping | null> {
  const supplierMappingFound = (await this.findOne({
    where: {
      supplier_product_code: ean,
      integrations_id: integrationsId,
    },
    include: [
      {
        model: Product,
        as: "product",
      },
    ],
  })) as unknown as FullSupplierMapping;

  return supplierMappingFound ?? null;
}
}

export default new SupplierMappingRepository();
