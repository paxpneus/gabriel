import BaseService from '../../../shared/utils/base-models/base-service';
import SupplierMapping from './supplier-mapping.model';
import supplierMappingRepository, { SupplierMappingRepository } from './supplier-mapping.repository';

export class SupplierMappingService extends BaseService<SupplierMapping, SupplierMappingRepository> {
  constructor() {
    super(supplierMappingRepository);
  }
}

export default new SupplierMappingService();
