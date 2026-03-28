import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Customer from "./customers.model";
export class CustomerRepository extends BaseRepository<Customer> {
    constructor() { super(Customer) }
}
export default new CustomerRepository();