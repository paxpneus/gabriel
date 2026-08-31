import { CreateOptions } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import SupplierMapping from "./supplier-mapping.model";
import supplierMappingRepository, {
  SupplierMappingRepository,
} from "./supplier-mapping.repository";
import {
  FullSupplierMapping,
  SupplierMappingCreationAttributes,
} from "./supplier-mapping.types";
import {
  resolveProductByEan,
} from "../../handlers/tecinco/queues/helpers/product.helpers";

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

    const product = await resolveProductByEan({
      ean: productCode,
      logPrefix: "[SupplierMappingService.create]",
    });

    if (product) {
      throw new Error(
        `Produto ou mapeamento já registrado com esse código ${productCode}`,
      );
    }

    return this.repository.create(data, options);
  }
}

export default new SupplierMappingService();
