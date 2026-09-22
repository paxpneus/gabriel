import { Transaction } from 'sequelize';
import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import ExpeditionBatchItems from '../batch-items/batch-items.model';
import ExpeditionBatchInvoice from '../batch-invoices/batch-invoices.model';
import Invoice from '../../fiscal/invoices/invoice/invoice.model';
import Product from '../../../inventory/products/product.model';
import BatchInvoiceItems from './batch-invoice-items.model';
import { pendingQuantityWhere } from './helpers/pending-filter';

export class BatchInvoiceItemsRepository extends BaseRepository<BatchInvoiceItems> {
  constructor() {
    super(BatchInvoiceItems);
  }

  findPendingByBatchItemId(
    expeditionBatchItemId: string,
    expeditionBatchInvoiceId?: string,
    t?: Transaction,
  ): Promise<BatchInvoiceItems[]> {
    return this.model.findAll({
      where: {
        expedition_batch_item_id: expeditionBatchItemId,
        ...(expeditionBatchInvoiceId
          ? { expedition_batch_invoice_id: expeditionBatchInvoiceId }
          : {}),
        ...pendingQuantityWhere(),
      },
      include: [
        {
          model: ExpeditionBatchItems,
          as: 'batchItem',
          include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
        },
        {
          model: ExpeditionBatchInvoice,
          as: 'batchInvoice',
          include: [{ model: Invoice, as: 'invoice', attributes: ['id', 'number_system'] }],
        },
      ],
      transaction: t,
    });
  }
}

export default new BatchInvoiceItemsRepository();
