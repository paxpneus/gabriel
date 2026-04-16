import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import ExpeditionBatchInvoice from './batch-invoices.model';

export class ExpeditionBatchInvoiceRepository extends BaseRepository<ExpeditionBatchInvoice> {
  constructor() {
    super(ExpeditionBatchInvoice);
  }
}

export default new ExpeditionBatchInvoiceRepository();
