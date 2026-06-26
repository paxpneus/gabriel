import {
  FullInvoice,
  FullInvoiceAttributes,
  FullInvoiceForAllUnits,
  InvoiceAttributes,
  InvoiceCreationData,
  ItemWithFiscal,
} from "./invoice.types";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import UnmappedInvoiceProduct from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import InvoiceItems from "../invoice-items/invoice-items.model";
import Invoice from "./invoice.model";
import { Product, ProductConfig, Supplier } from "../../../inventory";
import { FindOptions, Op, Sequelize, Transaction, WhereOptions } from "sequelize";
import ExpeditionBatchInvoice from "../../expedition/batch-invoices/batch-invoices.model";
import BatchInvoiceItems from "../../expedition/batch-invoice-items/batch-invoice-items.model";
import ExpeditionBatchItems from "../../expedition/batch-items/batch-items.model";
import ExpeditionBatch from "../../expedition/batch/batch.model";
import InvoiceUnitBusinessAttributes from "../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import UnitBusiness from "../../unit-business/unit-business.model";
import Transporter from "../../transporter/transporter.model";
import Store from "../../../sales/stores/stores.model";
import {
  PaginatedResult,
  QueryParams,
  QueryConfig,
} from "../../../../shared/query/query.types";
import { InvoiceUnitBusinessAttributesCreationAttributes, InvoiceUnitBusinessAttributesStatus } from "../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import { InvoiceItemsAttributes } from "../invoice-items/invoice-items.types";
import InvoiceFiscalItem from "../invoice-fiscal-item/invoice-fiscal-item.model";
import { InvoiceFiscalItemAttributes, InvoiceFiscalItemCreationAttributes } from "../invoice-fiscal-item/invoice-fiscal-item.types";

export class InvoiceRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  // ─── Subqueries reutilizáveis ────────────────────────────────────────────────

  private totalExpectedLiteral() {
    return Sequelize.literal(`(
      SELECT COALESCE(SUM(quantity_expected), 0)
      FROM invoice_items
      WHERE invoice_items.invoice_id = "Invoice"."id"
    )`);
  }

  private totalReadLiteral(unitBusinessId: string) {
    return Sequelize.literal(`(
    SELECT COALESCE(SUM(bii.quantity_read), 0)
    FROM expedition_batch_invoices ebi
    INNER JOIN batch_invoice_items bii ON bii.expedition_batch_invoice_id = ebi.id
    INNER JOIN expedition_batches eb ON eb.id = ebi.expedition_batch_id
    WHERE ebi.invoice_id = "Invoice"."id"
      AND eb.unit_business_id = '${unitBusinessId}'
  )`);
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
      [Op.and]: Sequelize.literal(`EXISTS (
        SELECT 1
        FROM invoice_items ii
        JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = "Invoice"."id"
          AND p.brand ${condition}
      )`),
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
    const brandWhere = this.extractBrandFilter(params.filters);
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
          model: UnitBusiness,
          as: "unitBusiness",
          attributes: ["number", "name"],
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
          [this.totalExpectedLiteral(), "total_expected"],
          [this.totalReadLiteral(unitBusinessId), "total_read"],
        ],
      },
    };

    const result = await this.findPaginated(params, queryConfig, {
      ...extraOptions,
      ...(brandWhere ? { where: brandWhere } : {}),
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
      }) as unknown as Invoice[],
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
          [this.totalExpectedLiteral(), "total_expected"],
          [this.totalReadLiteral(unitBusinessId), "total_read"],
        ],
      },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: { unit_business_id: unitBusinessId },
          required: false,
          attributes: ["status", "type", "batch_generated"],
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
    invoiceId: string,
  ): Promise<FullInvoiceForAllUnits> {
    const data = await this.findById(invoiceId, {
      attributes: {
        exclude: ["xml_path", "source_payload"],
        include: [
          [this.totalExpectedLiteral(), "total_expected"],
        ],
      },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: false,
          attributes: ["status", "type", "batch_generated"],
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

    if (!data) throw new Error(`Nota não encontrada`);

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
  ): Promise<FullInvoice> {
    const data = await this.findById(invoiceId, {
      attributes: {
        exclude: ["xml_path", "source_payload"],
        include: [
          [this.totalExpectedLiteral(), "total_expected"],
          [this.totalReadLiteral(unitBusinessId), "total_read"],
        ],
      },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: { unit_business_id: unitBusinessId },
          required: false,
          attributes: ["status", "type", "batch_generated"],
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
                          limit: 1,
                        },
                      ],
                    },
                  ],
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

    const plain = data.get({ plain: true }) as any;

    return {
      ...plain,
      unitBusinessAttributes: plain.unitBusinessAttributes?.[0] ?? null,
    } as FullInvoice;
  }

  async updateWithAttributes(
    invoiceIds: string[],
    unitBusinessId: string,
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
              ...(status !== undefined ? { status } : {}),
              ...(batch_generated !== undefined ? { batch_generated } : {}),
            },
            {
              where: {
                invoice_id: { [Op.in]: invoiceIds },
                unit_business_id: unitBusinessId,
                ...attrWhere,
              },
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
  await InvoiceItems.bulkCreate(items as InvoiceItemsAttributes[], { transaction });
}

async createInvoiceFiscalItems(
  items: InvoiceFiscalItemCreationAttributes[],
  transaction?: Transaction,
): Promise<void> {
  await InvoiceFiscalItem.bulkCreate(items as InvoiceFiscalItemAttributes[], { transaction });
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
}

export default new InvoiceRepository();
