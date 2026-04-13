import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import Invoice from './invoice.model';

export class InvoiceRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }
}

export default new InvoiceRepository();
