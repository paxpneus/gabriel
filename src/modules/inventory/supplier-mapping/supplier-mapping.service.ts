import { CreateOptions, UniqueConstraintError } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import SupplierMapping from "./supplier-mapping.model";
import supplierMappingRepository, {
  SupplierMappingRepository,
} from "./supplier-mapping.repository";
import {
  FullSupplierMapping,
  SupplierMappingCreationAttributes,
} from "./supplier-mapping.types";

export class SupplierMappingService extends BaseService<
  SupplierMapping,
  SupplierMappingRepository
> {
  constructor() {
    super(supplierMappingRepository);
  }

  async findByProductCode(ean: string): Promise<FullSupplierMapping | null> {
    if (!ean) {
      throw Error("EAN Não informado");
    }

    const supplierFound = await this.repository.findSupplierByProductCode(ean);

    if (!supplierFound) return null;

    return supplierFound;
  }

  async create(
    data: Partial<SupplierMappingCreationAttributes>,
    options?: CreateOptions,
  ): Promise<SupplierMapping> {
    const productCode = data.supplier_product_code;

    if (!productCode) {
      throw new Error("supplier_product_code não informado");
    }

    if (!data.integrations_id) {
      throw new Error("integrations_id não informado");
    }

    // Conflito (código já é gtin/gtin_package de outro produto na mesma
    // integração, ou já existe SupplierMapping com esse código nela) é
    // validado pelo próprio banco — unique index
    // product_supplier_maps_integrations_id_code_unique e o trigger
    // trigger_prevent_supplier_mapping_gtin_conflict — não precisa duplicar
    // a checagem aqui.
    try {
      return await this.repository.create(data, options);
    } catch (error: any) {
      if (error instanceof UniqueConstraintError) {
        throw new Error(
          `Já existe um SupplierMapping com o código ${productCode} nessa integração`,
        );
      }
      throw error;
    }
  }
}

export default new SupplierMappingService();
