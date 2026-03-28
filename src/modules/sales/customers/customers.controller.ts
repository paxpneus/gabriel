import BaseController from "../../../shared/utils/base-models/base-controller";
import Customer from "./customers.model";
import customerService, { CustomerService } from "./customers.service";
class CustomerController extends BaseController<Customer, CustomerService> {
    constructor() { super(customerService) }
}
export default new CustomerController();