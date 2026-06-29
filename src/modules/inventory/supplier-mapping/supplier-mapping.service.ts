import BaseService from '../../../shared/utils/base-models/base-service';
import SupplierMapping from './supplier-mapping.model';
import supplierMappingRepository, { SupplierMappingRepository } from './supplier-mapping.repository';
import { FullSupplierMapping } from './supplier-mapping.types';

export class SupplierMappingService extends BaseService<SupplierMapping, SupplierMappingRepository> {
  constructor() {
    super(supplierMappingRepository);
  }

  async findByProductCode(ean: string): Promise<FullSupplierMapping | null> {
    if (!ean) {
      throw Error("EAN Não informado")
    }

    const supplierFound = await this.repository.findSupplierByProductCode(ean)

    if (!supplierFound) return null

    return supplierFound
  }
}

export default new SupplierMappingService();
