import { Op, Transaction } from 'sequelize';
import BaseRepository from '../../../../../shared/utils/base-models/base-repository';
import InvoiceItems from './invoice-items.model';
import { InvoiceItemsAttributes } from './invoice-items.types';

export class InvoiceItemsRepository extends BaseRepository<InvoiceItems> {
  constructor() {
    super(InvoiceItems);
  }

  // Cria os itens da nota em lote (usado pela criação de nota com itens).
  async createInvoiceItems(
    items: Omit<InvoiceItemsAttributes, "id" | "createdAt" | "updatedAt">[],
    transaction?: Transaction,
  ): Promise<void> {
    await InvoiceItems.bulkCreate(items as InvoiceItemsAttributes[], {
      transaction,
    });
  }

  // Itens da nota que já existem pra esses produtos (usado pelo reprocesso de itens faltantes).
  async findByInvoiceId(
    invoiceId: string,
    productIds: string[],
    transaction?: Transaction,
  ): Promise<InvoiceItems[]> {
    return InvoiceItems.findAll({
      where: { invoice_id: invoiceId, product_id: { [Op.in]: productIds } },
      transaction,
    });
  }
}

export default new InvoiceItemsRepository();
