import BaseController from '../../../../shared/utils/base-models/base-controller';
import ExpeditionBatchInvoice from './batch-invoices.model';
import ExpeditionBatchInvoiceService from './batch-invoices.service';

export class ExpeditionBatchInvoiceController extends BaseController<ExpeditionBatchInvoice, typeof ExpeditionBatchInvoiceService> {
  constructor() {
    super(ExpeditionBatchInvoiceService);
  }
}

export default new ExpeditionBatchInvoiceController();
