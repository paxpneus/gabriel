import { Op, Transaction } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import invoiceItemsService from "../../invoices/invoice-items/invoice-items.service";
import invoiceService from "../../invoices/invoice/invoice.service";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import ExpeditionBatch from "../batch/batch.model";
import scanLogsService from "../scan-logs/scan-logs.service";
import ExpeditionBatchInvoice from "./batch-invoices.model";
import expeditionBatchInvoiceRepository, {
  ExpeditionBatchInvoiceRepository,
} from "./batch-invoices.repository";

export class ExpeditionBatchInvoiceService extends BaseService<
  ExpeditionBatchInvoice,
  ExpeditionBatchInvoiceRepository
> {
  constructor() {
    super(expeditionBatchInvoiceRepository);
  }

  async removeBatchInvoice(
    id: string,
    externalTransaction?: Transaction,
  ): Promise<void> {
    const run = async (t: Transaction) => {
      const batchInvoice = (await this.findById(id, {
        transaction: t,
      })) as ExpeditionBatchInvoice;

      if (!batchInvoice) {
        throw new Error(`Nota fiscal não encontrada`);
      }

      const expeditionBatch = await ExpeditionBatch.findByPk(
        batchInvoice.expedition_batch_id,
      );

      if (!expeditionBatch) {
        throw new Error(`Lote não encontrado!`);
      }

      if (["FINISHED", "CANCELLED"].includes(expeditionBatch!.status)) {
        throw new Error(`Não é possível remover notas fiscais de lotes finalizados ou cancelados.`);
      }

      const scanLogs = await scanLogsService.findAll({
        where: {
          expedition_batch_id: batchInvoice.expedition_batch_id,
          expedition_batch_invoices_id: batchInvoice.id,
        },
        transaction: t,
      });

      const invoiceFound = await invoiceService.findById(
        batchInvoice.invoice_id,
        { transaction: t },
      );

      if (!invoiceFound) {
        throw new Error(`Nota fiscal não existe no sistema`);
      }

      const invoiceItemsFound = await invoiceItemsService.findAll({
        where: { invoice_id: invoiceFound.id },
        transaction: t,
      });

      if (!invoiceItemsFound.length) {
        throw new Error(`Nota fiscal não possui itens`);
      }

      for (const item of invoiceItemsFound) {
        await ExpeditionBatchItems.decrement("quantity", {
          by: item.quantity_expected,
          where: {
            expedition_batch_id: batchInvoice.expedition_batch_id,
            product_id: item.product_id,
          },
          transaction: t,
        });

        await ExpeditionBatchItems.decrement("quantity_scanned", {
          by: item.quantity_received,
          where: {
            expedition_batch_id: batchInvoice.expedition_batch_id,
            product_id: item.product_id,
          },
          transaction: t,
        });

        await ExpeditionBatch.decrement("total_volumes", {
          by: item.quantity_expected,
          where: { id: batchInvoice.expedition_batch_id },
          transaction: t,
        });

        await ExpeditionBatch.decrement("total_volumes_received", {
          by: item.quantity_received,
          where: { id: batchInvoice.expedition_batch_id },
          transaction: t,
        });
      }

      await ExpeditionBatchItems.destroy({
        where: {
          expedition_batch_id: batchInvoice.expedition_batch_id,
          quantity: { [Op.lte]: 0 },
        },
        transaction: t,
      });

      const invoiceItemsId = invoiceItemsFound.map((s) => s.id);
      await invoiceItemsService.bulkUpdate(
        { quantity_received: 0, status: "PENDING" },
        {
          where: { id: invoiceItemsId },
          transaction: t,
        },
      );

      await invoiceService.update(
        batchInvoice.invoice_id,
        { status: "PENDING", batch_generated: false },
        { transaction: t },
      );

      await scanLogsService.bulkDelete({
        where: {
          expedition_batch_id: batchInvoice.expedition_batch_id,
          expedition_batch_invoices_id: batchInvoice.id,
        },
        transaction: t,
      });

      await ExpeditionBatchInvoice.destroy({
        where: { id: batchInvoice.id },
        transaction: t,
      });
    };

    if (externalTransaction) {
      return run(externalTransaction);
    } else {
      return sequelize.transaction(run);
    }
  }
}
export default new ExpeditionBatchInvoiceService();
