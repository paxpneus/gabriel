import BaseController from '../../../shared/utils/base-models/base-controller';
import Supplier from './supplier.model';
import SupplierService from './supplier.service';
import { authenticate } from '../../../middlewares/auth-token';

export class SupplierController extends BaseController<Supplier, typeof SupplierService> {
  constructor() {
    super(SupplierService);
  }

  // Sem middlewaresFor o CRUD genérico ficava aberto sem login.
  protected middlewaresFor() {
    return {
      index: [authenticate],
      show: [authenticate],
      create: [authenticate],
      bulkCreate: [authenticate],
      update: [authenticate],
      bulkUpdate: [authenticate],
      destroy: [authenticate],
      bulkDestroy: [authenticate],
    };
  }
}

export default new SupplierController();
