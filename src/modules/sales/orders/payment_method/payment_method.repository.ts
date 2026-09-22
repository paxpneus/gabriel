import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import PaymentMethod from "./payment_method.model";

export class PaymentMethodRepository extends BaseRepository<PaymentMethod> {
  constructor() {
    super(PaymentMethod);
  }
}

export default new PaymentMethodRepository();
