import { Sequelize } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Product from "../products/product.model";
import SupplierMapping from "./supplier-mapping.model";
import { FullSupplierMapping } from "./supplier-mapping.types";

export class SupplierMappingRepository extends BaseRepository<SupplierMapping> {
  constructor() {
    super(SupplierMapping);
  }

  async findSupplirByProductCode(
    ean: string,
  ): Promise<FullSupplierMapping | null> {
    const supplierMappingFound = (await this.findOne({
      where: Sequelize.where(
        Sequelize.fn("LTRIM", Sequelize.col("supplier_product_code"), "0"),
        ean.replace(/^0+/, ""),
      ),
      include: [
        {
          model: Product,
          as: "product",
        },
      ],
    })) as unknown as FullSupplierMapping;

    if (!supplierMappingFound) {
      return null;
    }

    return supplierMappingFound;
  }
}

export default new SupplierMappingRepository();
