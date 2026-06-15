import { FindOptions, Op, Sequelize } from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Invoice from "./invoice.model";
import invoiceRepository, { InvoiceRepository } from "./invoice.repository";
import UnitBusiness from "../../unit-business/unit-business.model";
import Transporter from "../../transporter/transporter.model";
import ExpeditionBatch from "../../expedition/batch/batch.model";
import ExpeditionBatchInvoice from "../../expedition/batch-invoices/batch-invoices.model";
import { InvoiceAttributes } from "./invoice.types";
import Store from "../../../sales/stores/stores.model";
import InvoiceItems from "../invoice-items/invoice-items.model";
import { getBrazilDate } from "../../../../shared/utils/normalizers/date";
import sequelize from "../../../../config/sequelize";
import batchInvoicesService from "../../expedition/batch-invoices/batch-invoices.service";
import { Product, ProductConfig, Supplier } from "../../../inventory";
import Contact from "../../../sales/contacts/contacts.model";
import Order from "../../../sales/orders/order/orders.model";
export class InvoiceService extends BaseService<Invoice, InvoiceRepository> {
  constructor() {
    super(invoiceRepository);

    this.queryConfig = {
      stringFields: ["receiver_cnpj", "sender_cnpj", "customer_document"],
      defaults: {
        perPage: 20,
        sortBy: ["status", "number_system"],
        sortDir: ["ASC", "ASC"],
      },
      // Campos para busca textual (LIKE)
      searchFields: ["customer_name", "sender_name", "number_system"],
      // Campos permitidos para filtros exatos (WHERE field = value)
      // ADICIONADO: 'type' e 'customer_name' aqui
      filterableFields: [
        "type",
        "unit_business_id",
        "transporter_id",
        "receiver_cnpj",
        "receiver_name",
        "sender_name",
        "sender_cnpj",
        "batch_generated",
        "printed_label",
        "emitted_at",
        "status",
        "store_id",
        "supplier_id"
      ],
      sortableFields: [
        "customer_name",
        "createdAt",
        "emitted_at",
        "received_at",
        "expected_receiving",
        "batch_generated",
        "printed_label",
        "type",
        "status",
        "number_system",
      ],
      customFields: {
        batchStatus: (value) => ({
          "$batchInvoice.batch.status$": Array.isArray(value)
            ? { [Op.in]: value }
            : value,
        }),
        pendingProcess: (value) => {
          // "Todos" → sem filtro
          if (value === "" || value === null || value === undefined) return {};

          // "Processo em andamento" (true) → notas que ainda têm algo pendente
          if (value === "true") {
            return {
              [Op.or]: [
                { batch_generated: false },
                { printed_label: false },
                {
                  status: {
                    [Op.notIn]: ["FINISHED", "CANCELLED"],
                  },
                },
              ],
            };
          }

          // "Processo finalizado" (false) → tudo concluído
          if (value === "false") {
            return {
              batch_generated: true,
              printed_label: true,
              status: {
                [Op.in]: ["FINISHED", "CANCELLED"],
              },
            };
          }

          return {};
        },
      },
    };
  }

  async findByIdFull(id: string, unitBusinessId?: string) {
    return this.repository.getFullInvoice(id, unitBusinessId);
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Invoice>> {
    const hasBatchFilter = !!params.filters?.batchStatus;

    return super.paginate(params, {
      ...extraOptions,
      subQuery: false,
      include: [
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
              attributes: ["number", "status", "mode", "id"],
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
          attributes: ["name"],
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
          [
            Sequelize.literal(`(
            SELECT COALESCE(SUM(quantity_expected), 0)
            FROM invoice_items
            WHERE invoice_items.invoice_id = "Invoice"."id"
          )`),
            "total_expected",
          ],
          [
            Sequelize.literal(`(
            SELECT COALESCE(SUM(quantity_received), 0)
            FROM invoice_items
            WHERE invoice_items.invoice_id = "Invoice"."id"
          )`),
            "total_received",
          ],
        ],
      },
    });
  }

  async updateInvoicesOpen(ids: string[], data: Partial<InvoiceAttributes>) {
    return await Invoice.update(data, {
      where: { id: ids, status: "OPEN" },
    });
  }

  async scheduleInvoice(id: string, expectedDate: string) {
    if (!expectedDate) {
      throw new Error("Data inválida");
    }

    const formatToBrazilDate = (dateStr: string): string => {
      const [year, month, day] = dateStr.split("-");
      return `${day}${month}${year}`;
    };

    const todayBR = getBrazilDate();
    const expectedBR = formatToBrazilDate(expectedDate);

    // if (expectedBR < todayBR) {
    //   throw new Error(
    //     "Data inválida, não é possível agendar notas para dias anteriores a hoje!",
    //   );
    // }

    const invoice = await this.findById(id);
    if (!invoice) {
      throw new Error("Nota fiscal não encontrada");
    }

    if (["LATE", "FINISHED", "CANCELLED"].includes(invoice.status)) {
      throw new Error(
        "Status não permitido para alterar data prevista de entrega",
      );
    }

    await invoice.update({
      status: "SCHEDULED",
      expected_receiving: expectedDate,
    });
  }

  async bondInvoice(id: string, bondedInvoiceId: string) {
    return sequelize.transaction(async (t) => {
      const invoice = await this.findById(id, {
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoice",
          },
        ],
        transaction: t,
      });

      if (!invoice) {
        throw new Error("Nota fiscal não encontrada!");
      }

      const invoiceToBond = await this.findById(bondedInvoiceId, {
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoice",
          },
        ],
        transaction: t,
      });

      if (!invoiceToBond) {
        throw new Error("Nota fiscal vinculada não encontrada!");
      }

      if (invoice.status != "PENDING_CANCELLED_SYSTEM") {
        throw new Error(
          "Status não permitido para vincular nota, apenas status CANCELAMENTO PENDENTE NA PLATAFORMA permitido!",
        );
      }

      await this.update(id, {
        bonded_invoice: invoiceToBond.number_system,
        status: "CANCELLED",
      });

      await this.update(bondedInvoiceId, {
        bonded_invoice: invoice.number_system,
      });

      if (invoice.batchInvoice) {
        await batchInvoicesService.removeBatchInvoice(
          invoice.batchInvoice.id,
          t,
        );
      }
    });
  }

  async getInvoiceProductReport(params: QueryParams) {
    params.filters = { ...params.filters };

    const rows = await this.findAll(
      {
        attributes: [
          "id",
          "id_system",
          "destination_city",
          "number_system",
          "seller_id",
        ],
        include: [
          {
            model: Contact,
            as: "seller",
            attributes: ["id", "name", "id_system"],
          },
          {
            model: InvoiceItems,
            as: "items",
            attributes: ["quantity_expected"],
            include: [
              {
                model: Product,
                as: "product",
                attributes: ["measure", "line", "brand"],
              },
            ],
          },
        ],
      },
      params,
      this.queryConfig,
    );

    const orderByInvoiceId = new Map<string, Order>();
    const orderByInvoiceSystemId = new Map<string, Order>();
    const invoiceIds = rows.map((invoice) => invoice.id).filter(Boolean);
    const invoiceSystemIds = rows
      .map((invoice) => invoice.id_system)
      .filter((idSystem): idSystem is string => Boolean(idSystem));

    if (invoiceIds.length || invoiceSystemIds.length) {
      const orderWhere: FindOptions["where"] = {
        [Op.or]: [
          ...(invoiceIds.length
            ? [{ invoice_id: { [Op.in]: invoiceIds } }]
            : []),
          ...(invoiceSystemIds.length
            ? [
                Sequelize.where(
                  Sequelize.literal(
                    `"Order"."source_payload" #>> '{notaFiscal,id}'`,
                  ),
                  { [Op.in]: invoiceSystemIds },
                ),
              ]
            : []),
        ],
      };

      const orders = await Order.findAll({
        where: orderWhere,
        attributes: [
          "id",
          "invoice_id",
          "date",
          "id_order_system",
          "number_order_system",
          "number_order_channel",
          "source_payload",
        ],
      });

      for (const order of orders) {
        if (order.invoice_id) {
          orderByInvoiceId.set(order.invoice_id, order);
        }

        const sourcePayload = order.source_payload as
          | { notaFiscal?: { id?: string | number } }
          | undefined;
        const sourceInvoiceId = sourcePayload?.notaFiscal?.id;
        if (sourceInvoiceId != null) {
          orderByInvoiceSystemId.set(String(sourceInvoiceId), order);
        }
      }
    }

    const result: {
      number_system: string | undefined;
      city: string | null;
      seller: {
        id: string;
        name: string;
        id_system: string;
      } | null;
      order: {
        id: string;
        date: Date | null;
        id_order_system?: string;
        number_order_system: string;
        number_order_channel: string;
      } | null;
      measure: string | null;
      quantity: number;
      line: string | null;
      brand: string | null;
    }[] = [];

    for (const invoice of rows) {
      const invoiceWithRelations = invoice as Invoice & {
        seller?: Contact | null;
        items?: (InvoiceItems & { product?: Product | null })[];
      };
      const order =
        orderByInvoiceId.get(invoice.id) ??
        (invoice.id_system
          ? orderByInvoiceSystemId.get(invoice.id_system)
          : undefined);

      for (const item of invoiceWithRelations.items ?? []) {
        result.push({
          number_system: invoice.number_system,
          city: invoice.destination_city ?? null,
          seller: invoiceWithRelations.seller
            ? {
                id: invoiceWithRelations.seller.id,
                name: invoiceWithRelations.seller.name,
                id_system: invoiceWithRelations.seller.id_system,
              }
            : null,
          order: order
            ? {
                id: order.id,
                date: order.date ?? null,
                id_order_system: order.id_order_system,
                number_order_system: order.number_order_system,
                number_order_channel: order.number_order_channel,
              }
            : null,
          measure: item.product?.measure ?? null,
          quantity: item.quantity_expected,
          line: item.product?.line ?? null,
          brand: item.product?.brand ?? null,
        });
      }
    }

    return result;
  }

  async getInvoiceSupplierReport(params: QueryParams, unitBusinessId: string) {
    params.filters = { ...params.filters };

    const rows = await this.findAll(
      {
        attributes: ["id", "number_system", "emitted_at", "xml_key"],
        include: [
          {
            model: InvoiceItems,
            as: "items",
            attributes: ["quantity_expected"],
            include: [
              {
                model: Product,
                as: "product",
                attributes: ["source_payload"],
                include: [
                  {
                    model: ProductConfig,
                    as: "productConfigs",
                    attributes: ["sku"],
                    where: unitBusinessId
                      ? { unit_business_id: unitBusinessId }
                      : undefined,
                    required: false,
                  },
                ],
              },
            ],
          },
        ],
      },
      params,
      this.queryConfig,
    );

    const result: {
      number_system: string | undefined;
      date: Date | null;
      xml_key: string | null;
      sku: string | null;
      description: string | null;
      quantity: number;
    }[] = [];

    for (const invoice of rows) {
      const invoiceWithRelations = invoice as Invoice & {
        items?: (InvoiceItems & {
          product?:
            | (Product & {
                productConfigs?: ProductConfig[];
                source_payload?: { descricao?: string } | null;
              })
            | null;
        })[];
      };

      for (const item of invoiceWithRelations.items ?? []) {
        const product = item.product;
        const productConfig = product?.productConfigs?.[0];
        const sourcePayload = product?.source_payload as
          | { descricaoCurta?: string }
          | undefined;

        result.push({
          number_system: invoice.number_system,
          date: invoice.emitted_at ?? null,
          xml_key: invoice.xml_key ?? null,
          sku: productConfig?.sku ?? null,
          description: sourcePayload?.descricaoCurta ?? null,
          quantity: item.quantity_expected,
        });
      }
    }

    return result;
  }
}

export default new InvoiceService();
