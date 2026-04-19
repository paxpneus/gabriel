import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import { Product, Stock } from "../../../inventory";
import InvoiceItems from "../../entrance/invoice-items/invoice-items.model";
import Invoice from "../../entrance/invoice/invoice.model";
import ExpeditionBatchInvoice from "../batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import ExpeditionBatch from "./batch.model";
import { ExpeditionBatchFull } from "./batch.types";

export class ExpeditionBatchRepository extends BaseRepository<ExpeditionBatch> {
  constructor() {
    super(ExpeditionBatch);
  }

  async getFullBatch(
    batchId?: string,
    number?: string,
  ): Promise<ExpeditionBatchFull> {
    let data;
    if (batchId) {
      data = await this.findById(batchId, {
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoices",
            include: [
              {
                model: Invoice,
                as: "invoice",
                include: [
                  {
                    model: InvoiceItems,
                    as: "items",
                  },
                ],
              },
            ],
          },
          {
            model: ExpeditionBatchItems,
            as: "items",
            include: [
              {
                model: Product,
                as: 'product',
                include: [{ model: Stock, as: 'stocks' }]
              }
            ]
          },
        ],
      });
    } else {
      data = await this.findOne({
        where: { number: number },
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoices",
            include: [
              {
                model: Invoice,
                as: "invoice",
                include: [
                  {
                    model: InvoiceItems,
                    as: "items",
                    include: [
                      {
                        model: Product,
                        as: 'product'
                      }
                    ]
                  },
                ],
              },
            ],
          },
          {
            model: ExpeditionBatchItems,
            as: "items",
            include: [
              {
                model: Product,
                as: 'product'
              }
            ]
          },
        ],
      });
    }

    if (!data) {
      throw new Error(`Lote não encontrado`);
    }

    return data.get({plain: true});
  }
}

export default new ExpeditionBatchRepository();
