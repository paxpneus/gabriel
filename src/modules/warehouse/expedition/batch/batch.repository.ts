import { FindOptions } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import { Product, Stock } from "../../../inventory";
import InvoiceItems from "../../entrance/invoice-items/invoice-items.model";
import Invoice from "../../entrance/invoice/invoice.model";
import Transporter from "../../transporter/transporter.model";
import UnitBusiness from "../../unit-business/unit-business.model";
import ExpeditionBatchInvoice from "../batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import ExpeditionBatch from "./batch.model";
import { ExpeditionBatchFull } from "./batch.types";
import User from "../../users/users/user.model";

export class ExpeditionBatchRepository extends BaseRepository<ExpeditionBatch> {
  constructor() {
    super(ExpeditionBatch);
  }

  async getFullBatch(
    batchId?: string,
    number?: string,
    options?: FindOptions
  ): Promise<ExpeditionBatchFull> {
    let data;
    if (batchId) {
      data = await this.findById(batchId, {
        include: [
          {
            model: User,
            as: 'operator'
          },
          {
            model: UnitBusiness,
            as: "unitBusiness",
          },
          {
            model: Transporter,
            as: "transporter",
          },
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoices",
            separate: true,
            include: [
              {
                model: Invoice,
                as: "invoice",
                attributes: { exclude: ["xml_path"] },
                include: [
                  {
                    model: InvoiceItems,
                    as: "items",
                    separate: true,
                    include: [
                      {
                        model: Product,
                        as: "product",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            model: ExpeditionBatchItems,
            as: "items",
            separate: true,
            include: [
              {
                model: Product,
                as: "product",
                include: [{ model: Stock, as: "stocks" }],
              },
            ],
          },
        ],
       ...options
      });
    } else {
      data = await this.findOne({
        where: { number: number },
        include: [
           {
            model: User,
            as: 'operator'
          },
          {
            model: UnitBusiness,
            as: "unitBusiness",
          },
          {
            model: Transporter,
            as: "transporter",
          },
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoices",
            separate: true,
            include: [
              {
                model: Invoice,
                as: "invoice",
                attributes: { exclude: ["xml_path"] },
                include: [
                  {
                    model: InvoiceItems,
                    separate: true,
                    as: "items",
                    include: [
                      {
                        model: Product,
                        as: "product",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            model: ExpeditionBatchItems,
            as: "items",
            separate: true,
            include: [
              {
                model: Product,
                as: "product",
                include: [{ model: Stock, as: "stocks" }],
              },
            ],
          },
        ],
        ...options
      });
    }

    if (!data) {
      throw new Error(`Lote não encontrado`);
    }

    return data.get({ plain: true });
  }

   async getFullBatches(
    batchIds?: string[],
    options?: FindOptions
  ): Promise<ExpeditionBatchFull[]> {
    let data;
      data = await this.findAll({
        where: {
          id: batchIds
        },
        include: [
          {
            model: User,
            as: 'operator'
          },
          {
            model: UnitBusiness,
            as: "unitBusiness",
          },
          {
            model: Transporter,
            as: "transporter",
          },
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoices",
            separate: true,
            include: [
              {
                model: Invoice,
                as: "invoice",
                attributes: { exclude: ["xml_path"] },
                include: [
                  {
                    model: InvoiceItems,
                    as: "items",
                    separate: true,
                    include: [
                      {
                        model: Product,
                        as: "product",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            model: ExpeditionBatchItems,
            as: "items",
            separate: true,
            include: [
              {
                model: Product,
                as: "product",
                include: [{ model: Stock, as: "stocks" }],
              },
            ],
          },
        ],
       ...options
      });
    

    if (!data) {
      throw new Error(`Lote não encontrado`);
    }

    return data.map((item) => item.get({ plain: true })) as ExpeditionBatchFull[]  }
}

export default new ExpeditionBatchRepository();
