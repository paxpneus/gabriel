import { Transaction } from 'sequelize';
import batchInvoiceItemsRepository, { BatchInvoiceItemsRepository } from './batch-invoice-items.repository';
import BaseService from '../../../../shared/utils/base-models/base-service';
import BatchInvoiceItems from './batch-invoice-items.model';

export class BatchInvoiceItemsService extends BaseService<BatchInvoiceItems, BatchInvoiceItemsRepository> {
  constructor() {
    super(batchInvoiceItemsRepository);
  }

  findBlockingByProductId(
    productId: string,
    transaction?: Transaction,
  ): Promise<BatchInvoiceItems | null> {
    return this.repository.findBlockingByProductId(productId, transaction);
  }
}

export default new BatchInvoiceItemsService();
