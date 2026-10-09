import { Op } from 'sequelize';
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

  // invoice_id → expedition_batch_id dos lotes da loja (notas fora de lote não entram no Map).
  async findBatchIdsByInvoiceIds(
    invoiceIds: string[],
    unitBusinessId: string,
  ): Promise<Map<string, string>> {
    if (!invoiceIds.length) return new Map();

    const rows = await ExpeditionBatchInvoice.findAll({
      where: { invoice_id: { [Op.in]: invoiceIds } },
      attributes: ['invoice_id', 'expedition_batch_id'],
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
    return new Map(rows.map((row) => [row.invoice_id, row.expedition_batch_id]));
  }
}

export default new ExpeditionBatchInvoiceRepository();
