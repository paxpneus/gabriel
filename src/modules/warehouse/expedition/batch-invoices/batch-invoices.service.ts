import BaseService from '../../../../shared/utils/base-models/base-service';
import ExpeditionBatchInvoice from './batch-invoices.model';
import expeditionBatchInvoiceRepository, { ExpeditionBatchInvoiceRepository } from './batch-invoices.repository';

export class ExpeditionBatchInvoiceService extends BaseService<ExpeditionBatchInvoice, ExpeditionBatchInvoiceRepository> {
  constructor() {
    super(expeditionBatchInvoiceRepository);
  }
}

export default new ExpeditionBatchInvoiceService();
