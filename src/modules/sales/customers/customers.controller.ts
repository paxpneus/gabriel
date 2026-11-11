import BaseController from "../../../shared/utils/base-models/base-controller";
import Customer from "./customers.model";
import customerService, { CustomerService } from "./customers.service";
import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
class CustomerController extends BaseController<Customer, CustomerService> {
    constructor() { super(customerService) }

    // Sem middlewaresFor o CRUD genérico ficava aberto sem login.
    protected middlewaresFor() {
      return {
        index: [authenticate, userPermissions],
        show: [authenticate, userPermissions],
        create: [authenticate, userPermissions],
        bulkCreate: [authenticate, userPermissions],
        update: [authenticate, userPermissions],
        bulkUpdate: [authenticate, userPermissions],
        destroy: [authenticate, userPermissions],
        bulkDestroy: [authenticate, userPermissions],
      };
    }
}
export default new CustomerController();