import BaseService from "../../../../shared/utils/base-models/base-service";
import PaymentMethod from "./payment_method.model";
import paymentMethodRepository, {
  PaymentMethodRepository,
} from "./payment_method.repository";

export class PaymentMethodService extends BaseService<
  PaymentMethod,
  PaymentMethodRepository
> {
  constructor() {
    super(paymentMethodRepository);
  }
}

export default new PaymentMethodService();
