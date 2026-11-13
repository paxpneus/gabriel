import { FindOptions, Op, literal, where } from "sequelize";
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
import { pickBatchAttribute } from "../utils/helpers/transshipment-resolver";
import User from "../../../company/users/users/user.model";
import BatchInvoiceItems from "../batch-invoice-items/batch-invoice-items.model";
import InvoiceUnitBusinessAttributes from "../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import {
  totalExpectedLiteral,
  totalReadLiteral,
} from "../../fiscal/invoices/invoice";
import { Literal } from "sequelize/lib/utils";
import Integration from "../../../integrations/integrations/integrations.model";
import { transporterSelectorSql } from "../../../sales/pdv-management/sales-request/helpers/transporter-cd";
import type { PdvTransporterSelector } from "../../../sales/pdv-management/sales-request/pdv-sales-request.types";

export class ExpeditionBatchRepository extends BaseRepository<ExpeditionBatch> {
  constructor() {
    super(ExpeditionBatch);
  }

  // include reutilizável — recebe unit_business_id e type do próprio batch (type: total lido só dos lotes desse tipo).
  private batchInvoicesInclude(unitBusinessId: string, batchType?: "INCOMING" | "OUTGOING") {
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
              [totalReadLiteral(unitBusinessId, "invoice", batchType), "total_read"],
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
      ? await this.findById(batchId, { attributes: ["id", "unit_business_id", "type"] , ...options,})
      : await this.findOne({
          where: { number },
          attributes: ["id", "unit_business_id", "type"],
          ...options,
        });

      
    if (!batchBase) throw new Error("Lote não encontrado");

    const unitBusinessId = (batchBase as any).unit_business_id;
    const batchType = (batchBase as any).type;

    const data = batchId
      ? await this.findById(batchId, {
          include: this.buildFullIncludes(unitBusinessId, batchType),
          ...options,
        })
      : await this.findOne({
          where: { number },
          include: this.buildFullIncludes(unitBusinessId, batchType),
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

   buildFullIncludes(unitBusinessId: string, batchType?: "INCOMING" | "OUTGOING") {
    return [
      { model: Integration, as: 'integration'},
      { model: User, as: "operator" },
      { model: UnitBusiness, as: "unitBusiness" },
      { model: Transporter, as: "transporter" },
      this.batchInvoicesInclude(unitBusinessId, batchType),
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

  // Atributo calculado `has_transshipment`: alguma nota do lote entrou como transbordo (selo nas listagens de lote).
  hasTransshipmentAttribute(): [Literal, string] {
    return [
      literal(`EXISTS (
        SELECT 1 FROM expedition_batch_invoices ebi
        WHERE ebi.expedition_batch_id = "ExpeditionBatch"."id"
          AND ebi.is_transshipment = TRUE
      )`),
      "has_transshipment",
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
              unitBusinessAttributes: pickBatchAttribute(
                bi.invoice.unitBusinessAttributes,
                plain.type,
                !!bi.is_transshipment,
              ),
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

  // Lotes de saída abertos da loja — da transportadora do seletor (do lote ou das notas dele), se houver — mais recentes primeiro.
  async findPendingOutgoingByTransporter(
    unitBusinessId: string,
    transporter: PdvTransporterSelector | null,
    batchId?: string,
  ): Promise<ExpeditionBatch[]> {
    return this.findAll({
      where: {
        ...(batchId && { id: batchId }),
        unit_business_id: unitBusinessId,
        type: "OUTGOING",
        status: { [Op.in]: ["OPEN", "PENDING"] },
        // Lote de nota interna nunca recebe nota do PDV.
        is_internal: false,
        [Op.and]: !transporter ? [] : [
          literal(`(
            EXISTS (
              SELECT 1 FROM transporters t
              WHERE t.id = "ExpeditionBatch"."transporters_id"
                AND ${transporterSelectorSql(transporter, { name: "t.name", id: "t.id" })}
            )
            OR EXISTS (
              SELECT 1 FROM expedition_batch_invoices bi
              JOIN invoices i ON i.id = bi.invoice_id
              WHERE bi.expedition_batch_id = "ExpeditionBatch"."id"
                AND ${transporterSelectorSql(transporter, { name: "i.transporter_name", id: "i.transporter_id" })}
            )
          )`),
        ],
      },
      attributes: [
        "id",
        "number",
        "status",
        "total_volumes",
        "delivery_note_generated_at",
        "createdAt",
      ],
      order: [["createdAt", "DESC"]],
    });
  }
}

export default new ExpeditionBatchRepository();
