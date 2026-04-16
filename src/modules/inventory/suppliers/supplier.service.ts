import BaseService from '../../../shared/utils/base-models/base-service';
import Supplier from './supplier.model';
import supplierRepository, { SupplierRepository } from './supplier.repository';

export class SupplierService extends BaseService<Supplier, SupplierRepository> {
  constructor() {
    super(supplierRepository);
  }
}

export default new SupplierService();
