import {
  FullInvoice,
  FullInvoiceAttributes,
  FullInvoiceForAllUnits,
  FullInvoiceMappedForFrontend,
  InvoiceAttributes,
  InvoiceCreationData,
  ItemWithFiscal,
} from "./invoice.types";
import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import UnmappedInvoiceProduct from "../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import InvoiceItems from "../invoice-items/invoice-items.model";
import Invoice from "./invoice.model";
import { Product, ProductConfig, Supplier } from "../../../../inventory";
import {
  FindOptions,
  Op,
  Sequelize,
  Transaction,
  WhereOptions,
} from "sequelize";
import ExpeditionBatchInvoice from "../../../expedition/batch-invoices/batch-invoices.model";
import BatchInvoiceItems from "../../../expedition/batch-invoice-items/batch-invoice-items.model";
import ExpeditionBatchItems from "../../../expedition/batch-items/batch-items.model";
import ExpeditionBatch from "../../../expedition/batch/batch.model";
import InvoiceUnitBusinessAttributes from "../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import UnitBusiness from "../../../../company/unit-business/unit-business.model";
import Transporter from "../../../transporter/transporter.model";
import Store from "../../../../sales/stores/stores.model";
import {
  PaginatedResult,
  QueryParams,
  QueryConfig,
} from "../../../../../shared/query/query.types";
import {
  InvoiceUnitBusinessAttributesCreationAttributes,
  InvoiceUnitBusinessAttributesStatus,
} from "../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import { InvoiceItemsAttributes } from "../invoice-items/invoice-items.types";
import InvoiceFiscalItem from "../invoice-fiscal-item/invoice-fiscal-item.model";
import {
  InvoiceFiscalItemAttributes,
  InvoiceFiscalItemCreationAttributes,
} from "../invoice-fiscal-item/invoice-fiscal-item.types";
import { BatchInvoiceItemsAttributes } from "../../../expedition/batch-invoice-items/batch-invoice-items.types";
import { totalExpectedLiteral, totalReadLiteral } from "./helpers/totals";
import { LOGISTIC_OCCURRENCE_CODES } from "../../../../handlers/logistic/constants/constants";

export class InvoiceRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  // ─── Subqueries reutilizáveis ────────────────────────────────────────────────

  private noLogisticOccurrenceAtAllLiteral() {
    return Sequelize.literal(`NOT EXISTS (
      SELECT 1
      FROM invoice_logistic_occurrences ilo
      WHERE ilo.invoice_id = "Invoice"."id"
    )`);
  }

  private hasOccurrenceButNotDeliveredLiteral() {
    return Sequelize.literal(`EXISTS (
    SELECT 1
    FROM invoice_logistic_occurrences ilo
    WHERE ilo.invoice_id = "Invoice"."id"
  ) AND NOT EXISTS (
    SELECT 1
    FROM invoice_logistic_occurrences ilo
    WHERE ilo.invoice_id = "Invoice"."id"
      AND ilo.occurrency_code = '${LOGISTIC_OCCURRENCE_CODES.DELIVERED}'
  )`);
  }

  async findInvoicesPendingLogisticOccurrence(): Promise<Invoice[]> {
    const now = new Date();

    const twentyDaysAgo = new Date(now);
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);

    const fortyFiveDaysAgo = new Date(now);
    fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

    return Invoice.findAll({
      subQuery: false,
      attributes: [
        "id",
        "xml_key",
        "sender_cnpj",
        "number_system",
        "transporter_id",
        "integrations_id",
      ],
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: true,
          where: {
            type: "OUTGOING",
            batch_generated: true,
          },
          attributes: ["status", "type", "batch_generated", "unit_business_id"],
          include: [
            {
              model: UnitBusiness,
              as: "unitBusiness",
              required: true,
              attributes: ["id", "cnpj"],
            },
          ],
        },
        {
          model: Transporter,
          as: "transporter",
          required: true,
          attributes: ["id", "name", "integrations_id"],
        },
        {
          model: ExpeditionBatchInvoice,
          as: "batchInvoice",
          required: true,
          attributes: ["id", "createdAt"],
          include: [
            {
              model: ExpeditionBatch,
              as: "batch",
              required: true,
              attributes: [
                "id",
                "number",
                "status",
                "mode",
                "unit_business_id",
                "delivery_note_generated_at",
              ],
            },
          ],
        },
      ],
      where: {
        [Op.and]: [
          // A unit business "dona" (OUTGOING) precisa ser a mesma cujo cnpj
          // emitiu a nota (sender_cnpj)
          Sequelize.where(
            Sequelize.col("unitBusinessAttributes->unitBusiness.cnpj"),
            Sequelize.col("Invoice.sender_cnpj"),
          ),
          // O romaneio precisa ter sido gerado pela mesma unit business
          Sequelize.where(
            Sequelize.col("batchInvoice->batch.unit_business_id"),
            Sequelize.col("unitBusinessAttributes.unit_business_id"),
          ),
          {
            [Op.or]: [
              // 1. Romaneio gerado nos últimos 5 dias, sem nenhuma ocorrência
              {
                "$batchInvoice.batch.delivery_note_generated_at$": {
                  [Op.gte]: twentyDaysAgo,
                },
                [Op.and]: this.noLogisticOccurrenceAtAllLiteral(),
              },
              // 2. Romaneio gerado nos últimos 45 dias, sem ocorrência "Entregue", porém que tenha alguma ocorrência
              {
                "$batchInvoice.batch.delivery_note_generated_at$": {
                  [Op.gte]: fortyFiveDaysAgo,
                },
                [Op.and]: this.hasOccurrenceButNotDeliveredLiteral(),
              },
            ],
          },
        ],
      },
    });
  }

  private productBrandsLiteral() {
    return Sequelize.literal(`(
      SELECT ARRAY_AGG(DISTINCT p.brand)
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = "Invoice"."id"
        AND p.brand IS NOT NULL
    )`);
  }

  // ─── Helper: extrai filtros de invoice_unit_business_attributes ──────────────

  private extractAttrFilters(
    filters: QueryParams["filters"],
    unitBusinessId: string,
  ): WhereOptions {
    const attrWhere: WhereOptions = {
      unit_business_id: unitBusinessId,
    };

    if (filters?.status) {
      (attrWhere as any).status = Array.isArray(filters.status)
        ? { [Op.in]: filters.status }
        : filters.status;
      delete filters.status;
    }

    if (filters?.type) {
      (attrWhere as any).type = Array.isArray(filters.type)
        ? { [Op.in]: filters.type }
        : filters.type;
      delete filters.type;
    }

    if (filters?.batch_generated !== undefined) {
      (attrWhere as any).batch_generated = filters.batch_generated;
      delete filters.batch_generated;
    }

    if (filters?.pendingProcess !== undefined) {
      const val = filters.pendingProcess;
      delete filters.pendingProcess;

      if (val === "true") {
        (attrWhere as any)[Op.or] = [
          { batch_generated: false },
          { status: { [Op.notIn]: ["FINISHED", "CANCELLED"] } },
        ];
      } else if (val === "false") {
        (attrWhere as any).batch_generated = true;
        (attrWhere as any).status = { [Op.in]: ["FINISHED", "CANCELLED"] };
      }
    }

    return attrWhere;
  }

  // ─── Helper: extrai filtro de batchStatus ───────────────────────────────────

  private extractBatchStatusFilter(
    filters: QueryParams["filters"],
  ): WhereOptions | null {
    if (!filters?.batchStatus) return null;

    const where: WhereOptions = {
      status: Array.isArray(filters.batchStatus)
        ? { [Op.in]: filters.batchStatus }
        : filters.batchStatus,
    };

    delete filters.batchStatus;
    return where;
  }

  // ─── Helper: filtro de brand via literal SQL ─────────────────────────────────

  private extractBrandFilter(
    filters: QueryParams["filters"],
  ): WhereOptions | null {
    if (!filters?.brand) return null;

    const value = filters.brand;
    delete filters.brand;

    const condition = Array.isArray(value)
      ? `IN (${value.map((v: string) => `'${v.replace(/'/g, "''")}'`).join(", ")})`
      : `= '${String(value).replace(/'/g, "''")}'`;

    return {
      [Op.and]: [
        Sequelize.literal(`EXISTS (
        SELECT 1
        FROM invoice_items ii
        JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = "Invoice"."id"
          AND p.brand ${condition}
      )`),
      ],
    } as WhereOptions;
  }

  // ─── Listagem paginada ───────────────────────────────────────────────────────

  async listInvoices(
    params: QueryParams,
    unitBusinessId: string,
    queryConfig: QueryConfig = {},
  ): Promise<PaginatedResult<FullInvoiceAttributes>> {
    const attrWhere = this.extractAttrFilters(params.filters, unitBusinessId);
    const batchStatusWhere = this.extractBatchStatusFilter(params.filters);
    const hasBatchFilter = !!batchStatusWhere;

    const extraOptions: Omit<
      FindOptions,
      "where" | "limit" | "offset" | "order"
    > = {
      subQuery: false,
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: attrWhere,
          required: true,
          attributes: ["status", "type", "batch_generated"],
          include: [
            {
              model: UnitBusiness,
              as: "unitBusiness",
            },
          ],
        },
        {
          model: ExpeditionBatchInvoice,
          as: "batchInvoice",
          required: hasBatchFilter,
          attributes: ["id"],
          include: [
            {
              model: ExpeditionBatch,
              as: "batch",
              required: hasBatchFilter,
              where: { unit_business_id: unitBusinessId },
              attributes: ["number", "status", "mode", "id"],
              ...(batchStatusWhere
                ? {
                    where: {
                      unit_business_id: unitBusinessId,
                      ...batchStatusWhere,
                    },
                  }
                : {}),
            },
          ],
        },
        {
          model: Store,
          as: "store",
          attributes: ["name"],
        },
        {
          model: Transporter,
          as: "transporter",
          attributes: ["name", "uf", "cnpj"],
        },
        {
          model: Supplier,
          as: "supplier",
          attributes: ["name"],
        },
      ],
      attributes: {
        exclude: ["source_payload"],
        include: [
          [this.productBrandsLiteral(), "product_brands"],
          [totalExpectedLiteral(), "total_expected"],
          [totalReadLiteral(unitBusinessId), "total_read"],
        ],
      },
    };

    const result = await this.findPaginated(params, queryConfig, {
      ...extraOptions,
    });

    return {
      ...result,
      data: result.data.map((invoice) => {
        const plain = invoice.get({ plain: true });
        return {
          ...plain,
          unitBusinessAttributes: plain.unitBusinessAttributes?.[0] ?? null,
          product_brands: (plain as any).product_brands ?? [],
          transporter: plain.transporter
            ? {
                ...plain.transporter,
                name: [
                  plain.transporter.name,
                  plain.transporter.uf,
                  plain.transporter.cnpj,
                ]
                  .filter(Boolean)
                  .join(" | "),
              }
            : plain.transporter,
        };
      }) as unknown as FullInvoiceAttributes[],
    };
  }

  // ─── Detalhe completo (sem batch) ───────────────────────────────────────────

  async getFullInvoice(
    invoiceId: string,
    unitBusinessId: string,
  ): Promise<FullInvoice> {
    const data = await this.findById(invoiceId, {
      attributes: {
        exclude: ["xml_path", "source_payload"],
        include: [
          [totalExpectedLiteral(), "total_expected"],
          [totalReadLiteral(unitBusinessId), "total_read"],
        ],
      },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: { unit_business_id: unitBusinessId },
          required: false,
          attributes: ["status", "type", "batch_generated"],
          include: [
            {
              model: UnitBusiness,
              as: "unitBusiness",
            },
          ],
        },
        {
          model: InvoiceItems,
          as: "items",
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
        {
          model: UnmappedInvoiceProduct,
          as: "unmappedProducts",
        },
      ],
    });

    if (!data) throw new Error(`Nota não encontrada`);

    return data.get({ plain: true }) as FullInvoice;
  }

  async getFullInvoiceForAllUnits(
    invoiceId?: string,
    invoiceKey?: string,
  ): Promise<FullInvoiceForAllUnits | null> {
    if (!invoiceId && !invoiceKey) {
      throw new Error("É necessário informar invoiceId ou invoiceKey.");
    }

    const data = await this.findOne({
      where: {
        ...(invoiceId ? { id: invoiceId } : { xml_key: invoiceKey }),
      },
      attributes: {
        exclude: ["xml_path", "source_payload"],
        include: [[totalExpectedLiteral(), "total_expected"]],
      },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: false,
          attributes: ["status", "type", "batch_generated"],
          include: [
            {
              model: UnitBusiness,
              as: "unitBusiness",
            },
          ],
        },
        {
          model: InvoiceItems,
          as: "items",
          include: [
            {
              model: Product,
              as: "product",
              attributes: { exclude: ["source_payload"] },
            },
          ],
        },
        {
          model: UnmappedInvoiceProduct,
          as: "unmappedProducts",
        },
      ],
    });

    if (!data) return null;

    return data.get({ plain: true }) as FullInvoiceForAllUnits;
  }

  async getInvoice(
    invoiceId: string,
    unitBusinessId: string,
  ): Promise<FullInvoice> {
    const data = await this.findById(invoiceId, {
      attributes: { exclude: ["xml_path", "source_payload"] },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: { unit_business_id: unitBusinessId },
          required: false,
          attributes: ["status", "type", "batch_generated"],
          include: [
            {
              model: UnitBusiness,
              as: "unitBusiness",
            },
          ],
        },
      ],
    });

    if (!data) throw new Error(`Nota não encontrada`);

    const plain = data.get({ plain: true }) as any;

    return {
      ...plain,
      unitBusinessAttributes: plain.unitBusinessAttributes?.[0] ?? null,
    } as FullInvoice;
  }

  // ─── Detalhe completo (com batch) ───────────────────────────────────────────

  async getFullInvoiceWithBatch(
    invoiceId: string,
    unitBusinessId: string,
  ): Promise<FullInvoiceMappedForFrontend> {
    const data = await this.findById(invoiceId, {
      attributes: {
        exclude: ["xml_path", "source_payload"],
        include: [
          [totalExpectedLiteral(), "total_expected"],
          [totalReadLiteral(unitBusinessId), "total_read"],
        ],
      },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: { unit_business_id: unitBusinessId },
          required: false,
          attributes: ["status", "type", "batch_generated"],
          include: [{ model: UnitBusiness, as: "unitBusiness" }],
        },
        {
          model: InvoiceItems,
          as: "items",
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
                },
              ],
            },
          ],
        },
        {
          model: ExpeditionBatchInvoice,
          as: "batchInvoice",
          required: false,
          include: [
            {
              model: ExpeditionBatch,
              as: "batch",
              where: { unit_business_id: unitBusinessId },
              attributes: ["number", "status", "mode", "id"],
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
                      attributes: [
                        "name",
                        "ean",
                        "ean_tribut",
                        "id_system",
                        "type",
                        "brand",
                      ],
                      include: [
                        {
                          model: ProductConfig,
                          as: "productConfigs",
                          attributes: [
                            "product_id",
                            "sku",
                            "price",
                            "unit_business_id",
                          ],
                          where: { unit_business_id: unitBusinessId },
                          required: false,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { model: UnmappedInvoiceProduct, as: "unmappedProducts" },
      ],
    });

    if (!data) throw new Error(`Nota não encontrada`);

    const plain = data.get({ plain: true }) as any;

    plain.items = plain.items?.map((item: any) => ({
      ...item,
      product: item.product
        ? {
            ...item.product,
            productConfigs: item.product.productConfigs?.[0] ?? [],
          }
        : item.product,
    }));

    if (plain.batchInvoice?.items) {
      plain.batchInvoice.items = plain.batchInvoice.items.map((bi: any) => ({
        ...bi,
        batchItem: bi.batchItem
          ? {
              ...bi.batchItem,
              product: bi.batchItem.product
                ? {
                    ...bi.batchItem.product,
                    productConfigs:
                      bi.batchItem.product.productConfigs?.slice(0, 1) ?? [],
                  }
                : bi.batchItem.product,
            }
          : bi.batchItem,
      }));
    }

    const batchItemsMap = new Map<string, any>(
      plain.batchInvoice?.items?.map((b: BatchInvoiceItemsAttributes) => [
        b.batchItem?.product_id,
        b,
      ]) ?? [],
    );

    return {
      ...plain,
      unitBusinessAttributes: plain.unitBusinessAttributes?.[0] ?? null,
      items: plain.items?.map((item: any) => ({
        ...item,
        status: batchItemsMap.get(item.product_id)?.status ?? "PENDING",
        quantity_read: batchItemsMap.get(item.product_id)?.quantity_read ?? 0,
      })),
    } as FullInvoiceMappedForFrontend;
  }

  async updateWithAttributes(
    invoiceIds: string[],
    unitBusinessId: string,
    data: Partial<
      InvoiceAttributes & {
        status: InvoiceUnitBusinessAttributesStatus;
        batch_generated: boolean;
      }
    >,
    attrWhere?: WhereOptions,
    transaction?: Transaction,
  ): Promise<void> {
    const { status, batch_generated, ...invoiceData } = data;

    await Promise.all([
      Object.keys(invoiceData).length > 0
        ? Invoice.update(invoiceData, {
            where: { id: { [Op.in]: invoiceIds } },
            transaction,
          })
        : Promise.resolve(),

      status !== undefined || batch_generated !== undefined
        ? InvoiceUnitBusinessAttributes.update(
            {
              ...(status !== undefined ? { status } : {}),
              ...(batch_generated !== undefined ? { batch_generated } : {}),
            },
            {
              where: {
                invoice_id: { [Op.in]: invoiceIds },
                unit_business_id: unitBusinessId,
                ...attrWhere,
              },
              transaction,
            },
          )
        : Promise.resolve(),
    ]);
  }

  async updateWithAttributesForAllUnits(
    invoiceIds: string[],
    data: Partial<
      InvoiceAttributes & { status: string; batch_generated: boolean }
    >,
    attrWhere?: WhereOptions,
  ): Promise<void> {
    const { status, batch_generated, ...invoiceData } = data;

    await Promise.all([
      Object.keys(invoiceData).length > 0
        ? Invoice.update(invoiceData, {
            where: { id: { [Op.in]: invoiceIds } },
          })
        : Promise.resolve(),

      status !== undefined || batch_generated !== undefined
        ? InvoiceUnitBusinessAttributes.update(
            {
              ...(status !== undefined ? { status: status as any } : {}),
              ...(batch_generated !== undefined ? { batch_generated } : {}),
            },
            {
              where: {
                invoice_id: { [Op.in]: invoiceIds },
                ...attrWhere,
              },
            },
          )
        : Promise.resolve(),
    ]);
  }

  async createInvoice(
    invoiceData: InvoiceCreationData,
    transaction?: Transaction,
  ): Promise<Invoice> {
    return Invoice.create(invoiceData as InvoiceAttributes, { transaction });
  }

  async createInvoiceItems(
    items: Omit<InvoiceItemsAttributes, "id" | "createdAt" | "updatedAt">[],
    transaction?: Transaction,
  ): Promise<void> {
    await InvoiceItems.bulkCreate(items as InvoiceItemsAttributes[], {
      transaction,
    });
  }

  async createInvoiceFiscalItems(
    items: InvoiceFiscalItemCreationAttributes[],
    transaction?: Transaction,
  ): Promise<void> {
    await InvoiceFiscalItem.bulkCreate(items as InvoiceFiscalItemAttributes[], {
      transaction,
    });
  }

  async findInvoiceAttribute(
    invoiceId: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<InvoiceUnitBusinessAttributes | null> {
    return InvoiceUnitBusinessAttributes.findOne({
      where: {
        invoice_id: invoiceId,
        unit_business_id: unitBusinessId,
      },
      transaction,
    });
  }

  async createInvoiceAttributes(
    attributes: InvoiceUnitBusinessAttributesCreationAttributes[],
    transaction?: Transaction,
  ): Promise<void> {
    await InvoiceUnitBusinessAttributes.bulkCreate(attributes, { transaction });
  }

  async findUnitBusinessesByCnpj(
    cnpjs: string[],
    transaction?: Transaction,
  ): Promise<{ id: string; cnpj: string }[]> {
    const results = await UnitBusiness.findAll({
      where: { cnpj: { [Op.in]: cnpjs } },
      attributes: ["id", "cnpj"],
      transaction,
    });
    return results.map((ub) => ({ id: ub.id, cnpj: (ub as any).cnpj }));
  }

  async findXmlPathsByIds(
    ids: string[],
  ): Promise<Pick<InvoiceAttributes, "id" | "xml_path" | "number_system">[]> {
    return this.model.findAll({
      where: { id: ids },
      attributes: ["id", "xml_path", "number_system"],
    });
  }
}

export default new InvoiceRepository();
