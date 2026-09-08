import { Op, Transaction } from 'sequelize';
import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import BatchInvoiceItems from './batch-invoice-items.model';
import ExpeditionBatchItems from '../batch-items/batch-items.model';

export class BatchInvoiceItemsRepository extends BaseRepository<BatchInvoiceItems> {
  constructor() {
    super(BatchInvoiceItems);
  }

  // Um produto já conferido fisicamente num lote de expedição (quantity_read
  // > 0) não pode ser apagado silenciosamente — é uma ação física real, mais
  // forte que só ter um item de lote reservado. Junta com ExpeditionBatchItems
  // (via a associação "batchItem", ver sequelize-associations.ts) porque
  // batch_invoice_items não tem product_id direto.
  async findBlockingByProductId(
    productId: string,
    transaction?: Transaction,
  ): Promise<BatchInvoiceItems | null> {
    return this.findOne({
      where: { quantity_read: { [Op.gt]: 0 } },
      include: [
        {
          model: ExpeditionBatchItems,
          as: 'batchItem',
          where: { product_id: productId },
          required: true,
          attributes: [],
        },
      ],
      transaction,
    });
  }
}

export default new BatchInvoiceItemsRepository();
