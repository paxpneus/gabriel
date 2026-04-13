import BaseController from '../../../../shared/utils/base-models/base-controller';
import Invoice from './invoice.model';
import InvoiceService from './invoice.service';

export class InvoiceController extends BaseController<Invoice, typeof InvoiceService> {
  constructor() {
    super(InvoiceService);
  }
}

export default new InvoiceController();
