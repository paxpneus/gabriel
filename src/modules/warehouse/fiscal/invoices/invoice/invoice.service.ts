import {
  FindOptions,
  Op,
  Sequelize,
  Transaction,
  WhereOptions,
} from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../../shared/query/query.types";
import BaseService from "../../../../../shared/utils/base-models/base-service";
import Invoice from "./invoice.model";
import invoiceRepository, { InvoiceRepository } from "./invoice.repository";
import UnitBusiness from "../../../../company/unit-business/unit-business.model";
import Transporter from "../../../transporter/transporter.model";
import ExpeditionBatch from "../../../expedition/batch/batch.model";
import ExpeditionBatchInvoice from "../../../expedition/batch-invoices/batch-invoices.model";
import {
  FullInvoiceAttributes,
  InvoiceAttributes,
  InvoiceCreationData,
  ItemWithFiscal,
} from "./invoice.types";
import Store from "../../../../sales/stores/stores.model";
import InvoiceItems from "../invoice-items/invoice-items.model";
import { getBrazilDate } from "../../../../../shared/utils/normalizers/date";
import sequelize from "../../../../../config/sequelize";
import batchInvoicesService from "../../../expedition/batch-invoices/batch-invoices.service";
import { Product, ProductConfig, Supplier } from "../../../../inventory";
import Contact from "../../../../sales/contacts/contacts.model";
import Order from "../../../../sales/orders/order/orders.model";
import {
  InvoiceUnitBusinessAttributesCreationAttributes,
  InvoiceUnitBusinessAttributesStatus,
} from "../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import { InvoiceFiscalItemCreationAttributes } from "../invoice-fiscal-item/invoice-fiscal-item.types";
import eventService from "../../../../company/events/event/event.service";
import redisService from "../../../../../shared/utils/base-models/base-redis";
import InvoiceUnitBusinessAttributes from "../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import userService from "../../../../company/users/users/user.service";
import {
  decryptXml,
  isEncrypted,
} from "../../../../../shared/utils/xml/xml-cipher";

const default_seller = "5ff76374-4d67-4ef3-a566-349a015f86b1";
export class InvoiceService extends BaseService<Invoice, InvoiceRepository> {
  constructor() {
    super(invoiceRepository);

    this.queryConfig = {
      stringFields: ["receiver_cnpj", "sender_cnpj", "customer_document"],
      defaults: {
        perPage: 20,
        sortBy: ["number_system"],
        sortDir: ["ASC", "ASC"],
      },
      // Campos para busca textual (LIKE)
      searchFields: ["customer_name", "sender_name", "number_system"],
      // Campos permitidos para filtros exatos (WHERE field = value)
      // ADICIONADO: 'type' e 'customer_name' aqui
      filterableFields: [
        "transporter_id",
        "receiver_cnpj",
        "receiver_name",
        "sender_name",
        "sender_cnpj",
        "printed_label",
        "emitted_at",
        "store_id",
        "supplier_id",
      ],
      sortableFields: [
        "customer_name",
        "createdAt",
        "emitted_at",
        "received_at",
        "expected_receiving",

        "printed_label",

        "number_system",
      ],
      customSort: {
        status: (dir) => ["unitBusinessAttributes", "status", dir],
        type: (dir) => ["unitBusinessAttributes", "type", dir],
        batch_generated: (dir) => [
          "unitBusinessAttributes",
          "batch_generated",
          dir,
        ],
      },
      customFields: {
        brand: (value) => ({
          [Op.and]: [
            Sequelize.literal(`EXISTS (
      SELECT 1
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = "Invoice"."id"
        AND p.brand ${
          Array.isArray(value)
            ? `IN (${value.map((v: string) => `'${v.replace(/'/g, "''")}'`).join(", ")})`
            : `= '${String(value).replace(/'/g, "''")}'`
        }
    )`),
          ],
        }),
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
        status: (value) => ({
          "$unitBusinessAttributes.status$": Array.isArray(value)
            ? { [Op.in]: value }
            : value,
        }),

        type: (value) => ({
          "$unitBusinessAttributes.type$": Array.isArray(value)
            ? { [Op.in]: value }
            : value,
        }),

        batch_generated: (value) => ({
          "$unitBusinessAttributes.batch_generated$": value === "true",
        }),

        unit_business_id: (value) => ({
          "$unitBusinessAttributes.unit_business_id$": Array.isArray(value)
            ? { [Op.in]: value }
            : value,
        }),
      },
    };
  }

  async listInvoicesPendingLogisticOccurrence(): Promise<Invoice[]> {
    return this.repository.findInvoicesPendingLogisticOccurrence();
  }

  async createWithRelations(
    invoiceData: InvoiceCreationData,
    items: ItemWithFiscal[],
    {
      transaction,
      initialStatus = "OPEN",
      invoiceType,
    }: {
      transaction?: Transaction;
      initialStatus?: InvoiceUnitBusinessAttributesStatus;
      mainUnitBusinessId?: string;
      invoiceType?: "INCOMING" | "OUTGOING";
    } = {},
  ): Promise<Invoice> {
    const t = transaction ?? (await sequelize.transaction());
    const isExternalTransaction = !!transaction;

    try {
      // ─── 1. Resolve unit businesses ──────────────────────────────────────
      const unitBusinesses = await this.repository.findUnitBusinessesByCnpj(
        [invoiceData.sender_cnpj, invoiceData.receiver_cnpj].filter(
          Boolean,
        ) as string[],
        t,
      );

      const cnpjMap = new Map(unitBusinesses.map((ub) => [ub.cnpj, ub.id]));
      const senderUbId = cnpjMap.get(invoiceData.sender_cnpj);
      const receiverUbId = cnpjMap.get(invoiceData.receiver_cnpj);

      // ─── 2. Cria a invoice ───────────────────────────────────────────────
      const invoice = await this.repository.createInvoice(
        { ...invoiceData },
        t,
      );

      // ─── 3. Cria items e fiscal items ─────────────────────
      const deduplicatedItems = items.reduce<ItemWithFiscal[]>((acc, item) => {
        const existing = acc.find((i) => i.product_id === item.product_id);
        if (existing) {
          existing.quantity_expected = Math.trunc(
            existing.quantity_expected + item.quantity_expected,
          );
        } else {
          acc.push({ ...item });
        }
        return acc;
      }, []);

      const invoiceItems = deduplicatedItems.map(
        ({ fiscal: _, ...itemData }) => ({
          ...itemData,
          invoice_id: invoice.id,
        }),
      );

      await this.repository.createInvoiceItems(invoiceItems, t);

      const fiscalItems = deduplicatedItems
        .map(({ fiscal, ...itemData }, index) =>
          fiscal
            ? {
                ...fiscal,
                invoice_id: invoice.id,
                item_number: fiscal.item_number ?? index + 1,
              }
            : null,
        )
        .filter(Boolean) as InvoiceFiscalItemCreationAttributes[];

      if (fiscalItems.length > 0) {
        await this.repository.createInvoiceFiscalItems(fiscalItems, t);
      }

      // ─── 4. Resolve attributes por cnpj ──────────────────────────────────
      const seen = new Set<string>();
      const attributes: InvoiceUnitBusinessAttributesCreationAttributes[] = [];

      const addAttr = (
        unitBusinessId: string,
        type: "INCOMING" | "OUTGOING",
        status: InvoiceUnitBusinessAttributesStatus,
      ) => {
        const key = `${invoice.id}:${unitBusinessId}`;
        if (seen.has(key)) return;
        seen.add(key);
        attributes.push({
          invoice_id: invoice.id,
          unit_business_id: unitBusinessId,
          type,
          status,
          batch_generated: false,
        });
      };

      if (senderUbId && receiverUbId) {
        addAttr(senderUbId, "OUTGOING", "OPEN");
        addAttr(receiverUbId, "INCOMING", initialStatus ?? "OPEN");
      } else if (senderUbId) {
        addAttr(senderUbId, invoiceType ?? "OUTGOING", initialStatus ?? "OPEN");
      } else if (receiverUbId) {
        addAttr(
          receiverUbId,
          invoiceType ?? "INCOMING",
          initialStatus ?? "OPEN",
        );
      }

      if (attributes.length > 0) {
        await this.repository.createInvoiceAttributes(attributes, t);
      }

      // ─── 5. Notifica operadores e admins

      const incomingUbId =
        receiverUbId ??
        (senderUbId && invoiceType === "INCOMING" ? senderUbId : undefined);

      if (incomingUbId) {
        await eventService.notifyByRoles({
          types: ["operator", "admin"],
          unitBusinessId: incomingUbId,
          title: "Nova nota fiscal recebida",
          description: `Nota ${invoice.number_system} foi recebida e aguarda agendamento.`,
          transaction: t,
        });
      }

      if (!isExternalTransaction) await t.commit();

      return invoice;
    } catch (err) {
      if (!isExternalTransaction) await t.rollback();
      throw err;
    }
  }

  async findByIdFull(id: string, unitBusinessId: string) {
    return this.repository.getFullInvoice(id, unitBusinessId);
  }

  async findByIdFullWithBatch(id: string, unitBusinessId: string) {
    return this.repository.getFullInvoiceWithBatch(id, unitBusinessId);
  }

  async findByIdFullForAllUnits(id?: string, xml_key?: string) {
    return this.repository.getFullInvoiceForAllUnits(id, xml_key);
  }

  async listInvoices(
    params: QueryParams,
    unitBusinessId: string,
  ): Promise<PaginatedResult<FullInvoiceAttributes>> {
    return this.repository.listInvoices(
      params,
      unitBusinessId,
      this.queryConfig,
    );
  }

  async updateInvoicesOpen(ids: string[], unitBusinessId: string) {
    return this.repository.updateWithAttributes(
      ids,
      unitBusinessId,
      { status: "PENDING" },
      { status: "OPEN" },
    );
  }

  async markAsInternalUse(ids: string[], unitBusinessId: string) {
    return this.repository.updateWithAttributes(ids, unitBusinessId, {
      status: "FINISHED",
      description: "Nota de uso e consumo",
    });
  }

  async updateInvoices(
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
    return this.repository.updateWithAttributes(
      invoiceIds,
      unitBusinessId,
      data,
      attrWhere,
      transaction,
    );
  }

  async updateInvoicesForAllUnitBusiness(
    invoiceIds: string[],
    data: Partial<
      InvoiceAttributes & { status: string; batch_generated: boolean }
    >,
    attrWhere?: WhereOptions,
  ): Promise<void> {
    return this.repository.updateWithAttributesForAllUnits(
      invoiceIds,
      data,
      attrWhere,
    );
  }

  async scheduleInvoice(
    id: string,
    expectedDate: string,
    unitBusinessId: string,
  ) {
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

    const invoice = await this.repository.getInvoice(id, unitBusinessId);
    if (!invoice) {
      throw new Error("Nota fiscal não encontrada");
    }

    if (
      ["LATE", "FINISHED", "CANCELLED"].includes(
        invoice.unitBusinessAttributes?.status!,
      )
    ) {
      throw new Error(
        "Status não permitido para alterar data prevista de entrega",
      );
    }

    await this.repository.updateWithAttributes([id], unitBusinessId, {
      status: "SCHEDULED",
      expected_receiving: expectedDate,
    });
  }

  async bondInvoice(
    id: string,
    bondedInvoiceId: string,
    unitBusinessId: string,
  ) {
    return sequelize.transaction(async (t) => {
      const invoice = await this.repository.getFullInvoiceWithBatch(
        id,
        unitBusinessId,
      );

      if (!invoice) {
        throw new Error("Nota fiscal não encontrada!");
      }

      const invoiceToBond = await this.repository.getFullInvoiceWithBatch(
        bondedInvoiceId,
        unitBusinessId,
      );

      if (!invoiceToBond) {
        throw new Error("Nota fiscal vinculada não encontrada!");
      }

      if (
        invoice.unitBusinessAttributes?.status != "PENDING_CANCELLED_SYSTEM"
      ) {
        throw new Error(
          "Status não permitido para vincular nota, apenas status CANCELAMENTO PENDENTE NA PLATAFORMA permitido!",
        );
      }

      await this.repository.updateWithAttributes([id], unitBusinessId, {
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

  async getInvoiceProductReport(params: QueryParams, unitBusinessId: string) {
    const queryParams: QueryParams = {
      ...params,
      filters: {
        ...params.filters,
      },
    };

    const rows = await this.findAll(
      {
        subQuery: false,
        attributes: [
          "id",
          "id_system",
          "destination_city",
          "number_system",
          "seller_id",
          "invoice_value",
        ],
        include: [
          {
            model: InvoiceUnitBusinessAttributes,
            as: "unitBusinessAttributes",
            required: true,
            attributes: [],
            where: {
              unit_business_id: unitBusinessId,
              type: params.filters?.type ?? "OUTGOING",
            },
          },
          {
            model: Contact,
            as: "seller",
            attributes: ["id", "name", "id_system"],
          },
          {
            model: InvoiceItems,
            as: "items",
            attributes: ["quantity_expected"],
            required: true,
            include: [
              {
                model: Product,
                as: "product",
                attributes: ["measure", "line", "brand"],
                required: true,
              },
            ],
          },
        ],
      },
      queryParams,
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

    const default_report_seler = await userService.findById(default_seller);

    const default_seller_body = {
      id: default_report_seler!.id,
      name: default_report_seler!.name,
      id_system: "",
    };

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
      value: number | null;
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
            : default_seller_body,
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
          value: invoice.invoice_value ?? null,
        });
      }
    }

    return result;
  }

  async getInvoiceSupplierReport(params: QueryParams, unitBusinessId: string) {
    const type = params.filters?.type ?? "OUTGOING";
    const rows = await this.findAll(
      {
        subQuery: false,
        attributes: ["id", "number_system", "emitted_at", "xml_key"],
        include: [
          {
            model: InvoiceUnitBusinessAttributes,
            as: "unitBusinessAttributes",
            required: true,
            attributes: [],
            where: {
              unit_business_id: unitBusinessId,
              type,
            },
          },
          {
            model: InvoiceItems,
            as: "items",
            attributes: ["quantity_expected"],
            required: true,
            include: [
              {
                model: Product,
                as: "product",
                attributes: ["name", "brand"],
                required: true,
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
      brand: string | null;
    }[] = [];

    for (const invoice of rows) {
      const invoiceWithRelations = invoice as Invoice & {
        items?: (InvoiceItems & {
          product?:
            | (Product & {
                productConfigs?: ProductConfig[];
                brand?: string | null;
                source_payload?: { descricaoCurta?: string } | null;
              })
            | null;
        })[];
      };

      for (const item of invoiceWithRelations.items ?? []) {
        const product = item.product;
        const productConfig = product?.productConfigs?.[0];

        result.push({
          number_system: invoice.number_system,
          date: invoice.emitted_at ?? null,
          xml_key: invoice.xml_key ?? null,
          sku: productConfig?.sku ?? null,
          description: product?.name ?? "",
          quantity: item.quantity_expected,
          brand: product?.brand ?? null,
        });
      }
    }

    return result;
  }

  async *streamXmlEntries(
    ids: string[],
    chunkSize = 100,
  ): AsyncGenerator<{ filename: string; xml: string }> {
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunkIds = ids.slice(i, i + chunkSize);
      const invoices = await this.repository.findXmlPathsByIds(chunkIds);

      for (const invoice of invoices) {
        let xml = invoice.xml_path;

        if (!xml || xml.startsWith("http")) {
          console.warn(
            `[XML BATCH] Invoice ${invoice.id}: XML não disponível, pulando.`,
          );
          continue;
        }

        try {
          if (isEncrypted(xml)) xml = decryptXml(xml);
          const filename = `nfe-${invoice.number_system ?? invoice.id}.xml`;
          yield { filename, xml };
        } catch (err: any) {
          console.error(`[XML BATCH] Erro invoice ${invoice.id}:`, err.message);
        }
      }
    }
  }
}

export default new InvoiceService();
