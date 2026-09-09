import { Transaction, WhereOptions } from 'sequelize';
import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import ExpeditionBatch from '../batch/batch.model';
import ExpeditionBatchInvoice from './batch-invoices.model';

export class ExpeditionBatchInvoiceRepository extends BaseRepository<ExpeditionBatchInvoice> {
  constructor() {
    super(ExpeditionBatchInvoice);
  }

  /**
   * Acha o batch invoice de uma nota numa unit_business específica,
   * opcionalmente restrito a uma direção/propósito de lote — usado pra
   * distinguir as 2 pernas (entrada/saída) de uma nota de transbordo.
   */
  async findByInvoiceAndUnitBusiness(
    invoiceId: string,
    unitBusinessId: string,
    opts: { type?: string; purpose?: string } = {},
    transaction?: Transaction,
  ): Promise<ExpeditionBatchInvoice | null> {
    const batchWhere: WhereOptions = { unit_business_id: unitBusinessId, ...opts };

    return ExpeditionBatchInvoice.findOne({
      where: { invoice_id: invoiceId },
      include: [{ model: ExpeditionBatch, as: "batch", where: batchWhere, required: true }],
      transaction,
    });
  }
}

export default new ExpeditionBatchInvoiceRepository();
