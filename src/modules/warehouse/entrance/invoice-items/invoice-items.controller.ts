import BaseController from '../../../../shared/utils/base-models/base-controller';
import InvoiceItems from './invoice-items.model';
import InvoiceItemsService from './invoice-items.service';

export class InvoiceItemsController extends BaseController<InvoiceItems, typeof InvoiceItemsService> {
  constructor() {
    super(InvoiceItemsService);
  }
}

export default new InvoiceItemsController();
