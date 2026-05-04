import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { Product } from "../../../inventory";
import UnmappedInvoiceProduct from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import ExpeditionBatchInvoice from "../../expedition/batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../../expedition/batch-items/batch-items.model";
import ExpeditionBatch from "../../expedition/batch/batch.model";
import invoiceService from "../invoice/invoice.service";
import InvoiceItems from "./invoice-items.model";
import invoiceItemsRepository, {
  InvoiceItemsRepository,
} from "./invoice-items.repository";

export class InvoiceItemsService extends BaseService<
  InvoiceItems,
  InvoiceItemsRepository
> {
  constructor() {
    super(invoiceItemsRepository);
  }

  async createInvoiceItem(invoiceItemDto: Partial<InvoiceItems>, newEan: string, unMappedProductId: string): Promise<void> {
    return sequelize.transaction(async (t) => {
      if (!invoiceItemDto.product_id) {
        throw new Error("Produto não encontrado!");
      }

      const unMappedProcut = await UnmappedInvoiceProduct.findByPk(unMappedProductId, {transaction: t})

      if (unMappedProcut && unMappedProcut.quantity != invoiceItemDto.quantity_expected) {
        throw new Error("Quantidade do item divergente da quantidade da nota")
      }

      const invoiceItem = await this.create(invoiceItemDto, {
        transaction: t,
      });

      const invoice = await invoiceService.findById(
        invoiceItemDto.invoice_id!,
        { transaction: t },
      );

      if (invoice?.batch_generated) {
        const batchInvoices = await ExpeditionBatchInvoice.findAll({
          where: {
            invoice_id: invoice.id,
          },
          transaction: t,
        });

        // Pega os expedition_batch_ids únicos
        const uniqueBatchIds = [
          ...new Set(batchInvoices.map((b) => b.expedition_batch_id)),
        ];

        await Promise.all(
          uniqueBatchIds.map(async (expedition_batch_id) => {
            await ExpeditionBatchItems.create(
              {
                expedition_batch_id,
                product_id: invoiceItemDto.product_id!,
                quantity: invoiceItemDto.quantity_expected!,
                quantity_scanned: 0,
              },
              { transaction: t },
            );

            await ExpeditionBatch.increment("total_volumes", {
              by: invoiceItemDto.quantity_expected,
              where: { id: expedition_batch_id },
              transaction: t,
            });

            await ExpeditionBatch.update(
              { status: "PENDING" },
              { where: { id: expedition_batch_id }, transaction: t },
            );
          }),
        );
      }

      if (newEan) {
        await Product.update(
          { ean_tribut: newEan },
          {
            where: {
              id: invoiceItemDto.product_id,
            },
            transaction: t,
          },
        );
      }

      await UnmappedInvoiceProduct.destroy({
        where: {
          id: unMappedProductId,
        },
        transaction: t,
      });
    });
  }
}

export default new InvoiceItemsService();
