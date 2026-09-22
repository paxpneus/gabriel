import { Transaction } from 'sequelize';
import batchInvoiceItemsRepository, { BatchInvoiceItemsRepository } from './batch-invoice-items.repository';
import BaseService from '../../../../shared/utils/base-models/base-service';
import BatchInvoiceItems from './batch-invoice-items.model';

export class BatchInvoiceItemsService extends BaseService<BatchInvoiceItems, BatchInvoiceItemsRepository> {
  constructor() {
    super(batchInvoiceItemsRepository);
  }

  findPendingByBatchItemId(
    expeditionBatchItemId: string,
    expeditionBatchInvoiceId?: string,
    t?: Transaction,
  ): Promise<BatchInvoiceItems[]> {
    return this.repository.findPendingByBatchItemId(
      expeditionBatchItemId,
      expeditionBatchInvoiceId,
      t,
    );
  }
}

export default new BatchInvoiceItemsService();
