import { Op, Sequelize, Transaction } from "sequelize";
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

  // SupplierMappings de OUTROS produtos com algum dos códigos na integração, com o nome do produto dono.
  findCodeOwnersInIntegration(
    codes: string[],
    integrationsId: string,
    excludeProductId: string | null,
    transaction?: Transaction,
  ): Promise<SupplierMapping[]> {
    return this.findAll({
      where: {
        supplier_product_code: { [Op.in]: codes },
        integrations_id: integrationsId,
        ...(excludeProductId ? { product_id: { [Op.ne]: excludeProductId } } : {}),
      },
      attributes: ["id", "product_id", "supplier_product_code"],
      include: [{ model: Product, as: "product", attributes: ["id", "name"] }],
      transaction,
    });
  }
}

export default new SupplierMappingRepository();
