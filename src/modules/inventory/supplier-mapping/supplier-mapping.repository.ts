import { Op, Sequelize, Transaction, WhereAttributeHash } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Product from "../products/product.model";
import SupplierMapping from "./supplier-mapping.model";
import { FullSupplierMapping, SupplierMappingAttributes } from "./supplier-mapping.types";

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

  // SupplierMapping com só o nome do produto dono (texto de auditoria/retorno do "Confirmar EAN físico").
  findWithProductName(id: string, transaction?: Transaction): Promise<SupplierMapping | null> {
    return this.findOne({
      where: { id },
      attributes: ["id", "product_id", "supplier_product_code", "integrations_id", "is_physical_override"],
      include: [{ model: Product, as: "product", attributes: ["id", "name"] }],
      transaction,
    });
  }

  // Todos os EANs definidos pelo físico na integração, com o nome do produto dono.
  findPhysicalOverridesInIntegration(integrationsId: string): Promise<SupplierMapping[]> {
    return this.findAll({
      where: { integrations_id: integrationsId, is_physical_override: true },
      attributes: ["id", "product_id", "supplier_product_code"],
      include: [{ model: Product, as: "product", attributes: ["id", "name"] }],
    });
  }

  // SupplierMappings de OUTROS produtos com algum dos códigos na integração, com o nome do produto dono.
  findCodeOwnersInIntegration(
    codes: string[],
    integrationsId: string,
    excludeProductId: string | null,
    transaction?: Transaction,
  ): Promise<SupplierMapping[]> {
    const where: WhereAttributeHash<SupplierMappingAttributes> = {
      supplier_product_code: { [Op.in]: codes },
      integrations_id: integrationsId,
    };
    if (excludeProductId) where.product_id = { [Op.ne]: excludeProductId };

    return this.findAll({
      where,
      attributes: ["id", "product_id", "supplier_product_code", "is_physical_override"],
      include: [{ model: Product, as: "product", attributes: ["id", "name"] }],
      transaction,
    });
  }
}

export default new SupplierMappingRepository();
