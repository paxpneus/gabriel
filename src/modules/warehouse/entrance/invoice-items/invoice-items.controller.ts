import { authenticate } from '../../../../middlewares/auth-token';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import InvoiceItems from './invoice-items.model';
import InvoiceItemsService from './invoice-items.service';

export class InvoiceItemsController extends BaseController<InvoiceItems, typeof InvoiceItemsService> {
  constructor() {
    super(InvoiceItemsService);
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

export default new InvoiceItemsController();
