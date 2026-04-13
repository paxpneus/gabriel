import BaseService from '../../../../shared/utils/base-models/base-service';
import InvoiceItems from './invoice-items.model';
import invoiceItemsRepository, { InvoiceItemsRepository } from './invoice-items.repository';

export class InvoiceItemsService extends BaseService<InvoiceItems, InvoiceItemsRepository> {
  constructor() {
    super(invoiceItemsRepository);
  }
}

export default new InvoiceItemsService();
