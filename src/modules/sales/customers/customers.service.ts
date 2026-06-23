import BaseService from "../../../shared/utils/base-models/base-service";
import Customer from "./customers.model";
import customerRepository, { CustomerRepository } from "./customers.repository";
export class CustomerService extends BaseService<Customer, CustomerRepository> {
  constructor() {
    super(customerRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: ["created_at", "name"],
        sortDir: "DESC",
      },
      searchFields: ["name"],
    };
  }
}
export default new CustomerService();
