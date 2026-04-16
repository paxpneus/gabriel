import BaseController from '../../../shared/utils/base-models/base-controller';
import Supplier from './supplier.model';
import SupplierService from './supplier.service';

export class SupplierController extends BaseController<Supplier, typeof SupplierService> {
  constructor() {
    super(SupplierService);
  }
}

export default new SupplierController();
