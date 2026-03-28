import BaseService from "../../../shared/utils/base-models/base-service";
import Customer from "./customers.model";
import customerRepository, { CustomerRepository } from "./customers.repository";
export class CustomerService extends BaseService<Customer, CustomerRepository> {
    constructor() { super(customerRepository) }
}
export default new CustomerService();