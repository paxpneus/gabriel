import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import InvoiceItems from './invoice-items.model';

export class InvoiceItemsRepository extends BaseRepository<InvoiceItems> {
  constructor() {
    super(InvoiceItems);
  }
}

export default new InvoiceItemsRepository();
