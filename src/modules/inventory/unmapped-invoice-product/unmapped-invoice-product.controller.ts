import { authenticate } from '../../../middlewares/auth-token';
import BaseController from '../../../shared/utils/base-models/base-controller';
import UnmappedInvoiceProduct from './unmapped-invoice-product.model';
import UnmappedInvoiceProductService from './unmapped-invoice-product.service';

export class UnmappedInvoiceProductController extends BaseController<UnmappedInvoiceProduct, typeof UnmappedInvoiceProductService> {
  constructor() {
    super(UnmappedInvoiceProductService);
  }

  protected middlewaresFor() {
        return {
          index: [authenticate],
          create: [authenticate],
          update: [
            authenticate
          ],
          show: [authenticate],
          destroy: [authenticate],
          login: [authenticate],
        };
      }
}

export default new UnmappedInvoiceProductController();
