import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import BatchInvoiceItems from './batch-invoice-items.model';

export class BatchInvoiceItemsRepository extends BaseRepository<BatchInvoiceItems> {
  constructor() {
    super(BatchInvoiceItems);
  }
}

export default new BatchInvoiceItemsRepository();
