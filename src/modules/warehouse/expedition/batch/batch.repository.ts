import { FindOptions, where } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import { Product, ProductConfig, Stock } from "../../../inventory";
import InvoiceItems from "../../fiscal/invoices/invoice-items/invoice-items.model";
import Invoice from "../../fiscal/invoices/invoice/invoice.model";
import Transporter from "../../transporter/transporter.model";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import ExpeditionBatchInvoice from "../batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import ExpeditionBatch from "./batch.model";
import { ExpeditionBatchFull } from "./batch.types";
import User from "../../../company/users/users/user.model";
import BatchInvoiceItems from "../batch-invoice-items/batch-invoice-items.model";
import InvoiceUnitBusinessAttributes from "../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import {
  totalExpectedLiteral,
  totalReadLiteral,
} from "../../fiscal/invoices/invoice/helpers/totals";
import { Literal } from "sequelize/lib/utils";
import Integration from "../../../integrations/integrations/integrations.model";

export class ExpeditionBatchRepository extends BaseRepository<ExpeditionBatch> {
  constructor() {
    super(ExpeditionBatch);
  }

  // include reutilizável — recebe unit_business_id do próprio batch
  private batchInvoicesInclude(unitBusinessId: string) {
    return {
      model: ExpeditionBatchInvoice,
      as: "batchInvoices",
      separate: true,
      include: [
        {
          model: Invoice,
          as: "invoice",
          attributes: {
            exclude: ["xml_path", "source_payload"],
            include: [
              [totalExpectedLiteral("invoice"), "total_expected"],
              [totalReadLiteral(unitBusinessId, "invoice"), "total_read"],
            ] as [Literal, string][],
          },
          include: [
            {
              model: InvoiceUnitBusinessAttributes,
              as: "unitBusinessAttributes",
              where: { unit_business_id: unitBusinessId },
              required: false,
              attributes: ["status", "type", "batch_generated", "unit_business_id"],
            },
          ],
        },
        {
          model: BatchInvoiceItems,
          as: "items",
          include: [
            {
              model: ExpeditionBatchItems,
              as: "batchItem",
              include: [
                {
                  model: Product,
                  as: "product",
                  attributes: { exclude: ["source_payload"] },
                  include: [
                    {
                      model: ProductConfig,
                      as: "productConfigs",
                      where: { unit_business_id: unitBusinessId },
                      required: false,
                      limit: 1,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  async getFullBatch(
    batchId?: string,
    number?: string,
    options?: FindOptions,
  ): Promise<ExpeditionBatchFull> {
    const batchBase = batchId
      ? await this.findById(batchId, { attributes: ["id", "unit_business_id"] })
      : await this.findOne({
          where: { number },
          attributes: ["id", "unit_business_id"],
        });

    if (!batchBase) throw new Error("Lote não encontrado");

    const unitBusinessId = (batchBase as any).unit_business_id;

    const data = batchId
      ? await this.findById(batchId, {
          include: this.buildFullIncludes(unitBusinessId),
          ...options,
        })
      : await this.findOne({
          where: { number },
          include: this.buildFullIncludes(unitBusinessId),
          ...options,
        });

    if (!data) throw new Error("Lote não encontrado");

    const plain = data.get({ plain: true }) as any;

    return this.normalizeBatchPlain(plain);
  }

  async getFullBatches(
    batchIds?: string[],
    options?: FindOptions,
  ): Promise<ExpeditionBatchFull[]> {
    const first = await this.findOne({
      where: { id: batchIds },
      attributes: ["unit_business_id"],
    });

    if (!first) throw new Error("Lotes não encontrados");

    const unitBusinessId = (first as any).unit_business_id;

    const data = await this.findAll({
      where: { id: batchIds },
      include: this.buildFullIncludes(unitBusinessId),
      ...options,
    });

    return data.map((item) =>
      this.normalizeBatchPlain(item.get({ plain: true })),
    ) as ExpeditionBatchFull[];
  }

   buildFullIncludes(unitBusinessId: string) {
    return [
      { model: Integration, as: 'integration'},
      { model: User, as: "operator" },
      { model: UnitBusiness, as: "unitBusiness" },
      { model: Transporter, as: "transporter" },
      this.batchInvoicesInclude(unitBusinessId),
      {
        model: ExpeditionBatchItems,
        as: "items",
        separate: true,
        include: [
          {
            model: Product,
            as: "product",
            attributes: { exclude: ["source_payload"] },
            include: [{ model: Stock, as: "stocks", where: {
              unit_business_id: unitBusinessId
            } }],
          },
        ],
      },
    ];
  }

  normalizeBatchPlain(plain: any): ExpeditionBatchFull {
    return {
      ...plain,
      batchInvoices: plain.batchInvoices?.map((bi: any) => ({
        ...bi,
        invoice: bi.invoice
          ? {
              ...bi.invoice,
              unitBusinessAttributes:
                bi.invoice.unitBusinessAttributes?.[0] ?? null,
            }
          : bi.invoice,
        items: bi.items?.map((item: any) => ({
          ...item,
          product: item.batchItem?.product
            ? {
                ...item.batchItem.product,
                sku: item.batchItem.product.productConfigs?.[0]?.sku ?? null,
                price:
                  item.batchItem.product.productConfigs?.[0]?.price ?? null,
              }
            : null,
        })),
      })),
    } as ExpeditionBatchFull;
  }
}

export default new ExpeditionBatchRepository();
