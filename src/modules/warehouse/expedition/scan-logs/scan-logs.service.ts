import { Op } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { Product } from "../../../inventory";
import Invoice from "../../entrance/invoice/invoice.model";
import ExpeditionBatchInvoice from "../batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import batchItemsService, {
  ExpeditionBatchItemsService,
} from "../batch-items/batch-items.service";
import { ExpeditionBaatchItemFull } from "../batch-items/batch-items.types";
import ExpeditionBatch from "../batch/batch.model";
import { ExpeditionBatchFull } from "../batch/batch.types";
import ExpeditionScanLog from "./scan-logs.model";
import expeditionScanLogRepository, {
  ExpeditionScanLogRepository,
} from "./scan-logs.repository";
import InvoiceItems from "../../entrance/invoice-items/invoice-items.model";

export class ExpeditionScanLogService extends BaseService<
  ExpeditionScanLog,
  ExpeditionScanLogRepository
> {
  private batchItemService: ExpeditionBatchItemsService;

  constructor() {
    super(expeditionScanLogRepository);

    this.batchItemService = batchItemsService;

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "created_at",
        sortDir: "DESC",
      },
      // Campos para busca textual (LIKE)
      searchFields: ["label_full_code"],
      // Campos permitidos para filtros exatos (WHERE field = value)
      // ADICIONADO: 'type' e 'customer_name' aqui
      filterableFields: [
        "expedition_batch_id",
        "expedition_batch_items_id",
        "expedition_batch_invoices_id",
        "user_id",
      ],
      sortableFields: ["vol_number"],
    };
  }

  async scanProduct(
    labelcode: string,
    productcode: string,
    batchid: string,
    userId: string,
  ) {
    return await sequelize.transaction(async (t) => {
      if (labelcode.length < 41) {
        throw Error("Etiqueta inválida");
      }

      const nffromlabel = labelcode.substring(14, 22);
      const eanfromlabel = labelcode.substring(22, 35);
      const labelRead = labelcode;
      const volRead = labelcode.substring(35, 41);

      const alreadyExists = await ExpeditionScanLog.findOne({
        where: {
          label_full_code: labelRead,
        },
        transaction: t,
      });

      if (alreadyExists)
        throw Error(
          `Volume ${volRead} já lido no lote para nota ${nffromlabel}`,
        );

      const invoiceRead = (await ExpeditionBatch.findOne({
        where: { id: batchid },
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoices",
            include: [
              {
                model: Invoice,
                as: "invoice",
                where: {
                  number_system: {
                    [Op.iLike]: `%${nffromlabel.replace(/^0+/, "")}`,
                  },
                },
              },
            ],
          },
        ],
        transaction: t,
      })) as ExpeditionBatchFull;

      if (!invoiceRead) throw Error("Nota não encontrada no lote");

      const productRead = (await ExpeditionBatchItems.findOne({
        where: { expedition_batch_id: batchid },
        include: [
          {
            model: Product,
            as: "product",
            where: { sku: productcode },
          },
        ],
        transaction: t,
      })) as ExpeditionBaatchItemFull;

      if (!productRead) throw Error("Produto não encontrado");

      const productReadLocked = (await ExpeditionBatchItems.findOne({
        where: { id: productRead.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      })) as ExpeditionBaatchItemFull;

      productReadLocked.product = productRead.product;

      if (productReadLocked.quantity_scanned >= productReadLocked.quantity) {
        throw Error("Produto já totalmente bipado");
      }

      if (productRead.product.ean != eanfromlabel) {
        throw Error("Etiqueta não pertencente ao produto lido!");
      }

      try {
        await ExpeditionScanLog.create(
          {
            expedition_batch_items_id: productRead.id,
            expedition_batch_invoices_id: invoiceRead?.batchInvoices?.[0].id,
            expedition_batch_id: invoiceRead.id,
            label_full_code: labelRead,
            vol_number: volRead,
            user_id: userId,
          },
          { transaction: t },
        );
      } catch (error: any) {
        if (error.name === "SequelizeUniqueConstraintError") {
          throw new Error(`Volume ${volRead} já lido`);
        }
        throw error;
      }

      await this.batchItemService.updateBatchItemAndBatch(
        productRead.id,
        invoiceRead?.batchInvoices?.[0]?.invoice?.id!,
        productRead.product_id,
        t,
      );

      const invoiceId = invoiceRead?.batchInvoices?.[0]?.invoice?.id!;

      const invoiceItem = await InvoiceItems.findOne({
  where: { invoice_id: invoiceId },
  attributes: ['quantity_expected', 'quantity_received'],
  transaction: t,
})

const allDone = await InvoiceItems.count({
  where: {
    invoice_id: invoiceId,
    quantity_received: { [Op.lt]: sequelize.col('quantity_expected') }
  },
  transaction: t,
})

if (allDone === 0) {
  await Invoice.update(
    { status: 'FINISHED' },
    { where: { id: invoiceId }, transaction: t }
  )
}
    });
  }
}

export default new ExpeditionScanLogService();
