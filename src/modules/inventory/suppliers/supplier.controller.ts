import BaseController from '../../../shared/utils/base-models/base-controller';
import Supplier from './supplier.model';
import SupplierService from './supplier.service';
import { authenticate } from '../../../middlewares/auth-token';
import { userPermissions } from "../../../middlewares/user-permissions";

export class SupplierController extends BaseController<Supplier, typeof SupplierService> {
  constructor() {
    super(SupplierService);
  }

  // Sem middlewaresFor o CRUD genérico ficava aberto sem login.
  protected middlewaresFor() {
    return {
      index: [authenticate],
      show: [authenticate],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }
}

export default new SupplierController();
