import BaseService from '../../../../shared/utils/base-models/base-service';
import ExpeditionBatch from './batch.model';
import expeditionBatchRepository, { ExpeditionBatchRepository } from './batch.repository';
import ExpeditionBatchInvoice from '../batch-invoices/batch-invoices.model';
import ExpeditionBatchItems from '../batch-items/batch-items.model';
import InvoiceItems from '../../entrance/invoice-items/invoice-items.model';
import Invoice from '../../entrance/invoice/invoice.model';
import sequelize from '../../../../config/sequelize';

export class ExpeditionBatchService extends BaseService<ExpeditionBatch, ExpeditionBatchRepository> {
  constructor() {
    super(expeditionBatchRepository);
  }

  /**
   * Gera lotes de expedição a partir de uma lista de invoices.
   * - Se a invoice já tem batch_generated = true, apenas busca o lote existente.
   * - Caso contrário, cria um novo batch (status OPEN), vincula via ExpeditionBatchInvoice,
   *   gera os ExpeditionBatchItems a partir dos InvoiceItems e marca a invoice como batch_generated.
   *
   * Retorna um array com os batches gerados/encontrados.
   */
  async generateBatchesFromInvoices(invoiceIds: string[]): Promise<ExpeditionBatch[]> {
    const results: ExpeditionBatch[] = [];

    for (const invoiceId of invoiceIds) {
      const invoice = await Invoice.findByPk(invoiceId, {
        include: [{ model: InvoiceItems, as: 'items' }],
      });

      if (!invoice) continue;

      // Se já tem lote gerado, apenas busca e retorna o lote existente
      if (invoice.batch_generated) {
        const existingBatchInvoice = await ExpeditionBatchInvoice.findOne({
          where: { invoice_id: invoiceId },
          include: [{ model: ExpeditionBatch, as: 'batch' }],
        });

        if (existingBatchInvoice) {
          const existingBatch = await ExpeditionBatch.findByPk(
            existingBatchInvoice.expedition_batch_id
          );
          if (existingBatch && !results.find(b => b.id === existingBatch.id)) {
            results.push(existingBatch);
          }
        }
        continue;
      }

      // Cria o novo lote dentro de uma transaction
      const batch = await sequelize.transaction(async (t) => {
        // Gera número único para o lote
        const batchNumber = `LOTE-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        const newBatch = await ExpeditionBatch.create(
          {
            number: batchNumber,
            status: 'OPEN',
            unit_business_id: invoice.unit_business_id,
            total_volumes: 0,
            integrations_id: invoice.integrations_id,
          },
          { transaction: t }
        );

        // Vincula a invoice ao lote
        await ExpeditionBatchInvoice.create(
          {
            expedition_batch_id: newBatch.id,
            invoice_id: invoice.id,
          },
          { transaction: t }
        );

        // Gera os batch items a partir dos invoice items
        const invoiceItems: InvoiceItems[] = (invoice as any).items ?? [];
        let totalVolumes = 0;

        for (const item of invoiceItems) {
          await ExpeditionBatchItems.create(
            {
              expedition_batch_id: newBatch.id,
              product_id: item.product_id,
              quantity: item.quantity_expected,
              quantity_scanned: 0,
            },
            { transaction: t }
          );
          totalVolumes += item.quantity_expected;
        }

        // Atualiza total de volumes no lote
        await newBatch.update({ total_volumes: totalVolumes }, { transaction: t });

        // Marca a invoice como batch_generated
        await invoice.update({ batch_generated: true }, { transaction: t });

        return newBatch;
      });

      results.push(batch);
    }

    return results;
  }
}

export default new ExpeditionBatchService();