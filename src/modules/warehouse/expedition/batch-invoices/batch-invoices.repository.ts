import { Op, Transaction } from 'sequelize';
import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import ExpeditionBatch from '../batch/batch.model';
import ExpeditionBatchInvoice from './batch-invoices.model';

export class ExpeditionBatchInvoiceRepository extends BaseRepository<ExpeditionBatchInvoice> {
  constructor() {
    super(ExpeditionBatchInvoice);
  }

  // type: a loja de transbordo tem lote de entrada e de expedição da mesma nota.
  async findBatchIdByInvoiceId(
    invoiceId: string,
    unitBusinessId: string,
    type?: 'INCOMING' | 'OUTGOING',
    transaction?: Transaction,
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
          where: { unit_business_id: unitBusinessId, ...(type && { type }) },
        },
      ],
      transaction,
    });
    return row?.expedition_batch_id ?? null;
  }

  // invoice_id → expedition_batch_id dos lotes da loja (notas fora de lote não entram no Map); type como em findBatchIdByInvoiceId.
  async findBatchIdsByInvoiceIds(
    invoiceIds: string[],
    unitBusinessId: string,
    type?: 'INCOMING' | 'OUTGOING',
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
          where: { unit_business_id: unitBusinessId, ...(type && { type }) },
        },
      ],
    });
    return new Map(rows.map((row) => [row.invoice_id, row.expedition_batch_id]));
  }

  // Vínculos da nota em lotes ainda abertos, de qualquer loja/tipo — o cancelamento tira a nota de todos.
  async findOpenIdsByInvoiceId(invoiceId: string): Promise<string[]> {
    const rows = await ExpeditionBatchInvoice.findAll({
      where: { invoice_id: invoiceId },
      attributes: ['id'],
      include: [
        {
          model: ExpeditionBatch,
          as: 'batch',
          required: true,
          attributes: [],
          // Só FINISHED fecha: o enum do status do lote não tem CANCELLED (NOT IN com ele quebra no Postgres).
          where: { status: { [Op.ne]: 'FINISHED' } },
        },
      ],
    });
    return rows.map((row) => row.id);
  }
}

export default new ExpeditionBatchInvoiceRepository();
