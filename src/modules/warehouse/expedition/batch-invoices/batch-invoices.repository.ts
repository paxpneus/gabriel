import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import ExpeditionBatch from '../batch/batch.model';
import ExpeditionBatchInvoice from './batch-invoices.model';

export class ExpeditionBatchInvoiceRepository extends BaseRepository<ExpeditionBatchInvoice> {
  constructor() {
    super(ExpeditionBatchInvoice);
  }

  async findBatchIdByInvoiceId(
    invoiceId: string,
    unitBusinessId: string,
  ): Promise<string | null> {
    const row = await ExpeditionBatchInvoice.findOne({
      where: { invoice_id: invoiceId },
      attributes: ['expedition_batch_id'],
      include: [
        {
          model: ExpeditionBatch,
          as: 'batch',
          required: true,
          attributes: [],
          where: { unit_business_id: unitBusinessId },
        },
      ],
    });
    return row?.expedition_batch_id ?? null;
  }
}

export default new ExpeditionBatchInvoiceRepository();
