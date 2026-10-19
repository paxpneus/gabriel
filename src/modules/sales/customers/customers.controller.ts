import BaseController from "../../../shared/utils/base-models/base-controller";
import Customer from "./customers.model";
import customerService, { CustomerService } from "./customers.service";
import { authenticate } from "../../../middlewares/auth-token";
class CustomerController extends BaseController<Customer, CustomerService> {
    constructor() { super(customerService) }

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
export default new CustomerController();