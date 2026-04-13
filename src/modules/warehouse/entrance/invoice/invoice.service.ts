import BaseService from '../../../../shared/utils/base-models/base-service';
import Invoice from './invoice.model';
import invoiceRepository, { InvoiceRepository } from './invoice.repository';

export class InvoiceService extends BaseService<Invoice, InvoiceRepository> {
  constructor() {
    super(invoiceRepository);
  }
}

export default new InvoiceService();
