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
import {
  pendingMercadoLivreWhere,
  allTodayMercadoLivreWhere,
  finishedMercadoLivreWhere,
  dispatchedMercadoLivreWhere,
  productRimWhere,
  supplierDiscountMatchWhere,
} from "./helpers/custom-filters";
import supplierDiscountRuleService from "../../../../inventory/supplier-discount-rules/supplier-discount-rule.service";
import { SupplierDiscountBypassItemInput } from "../../../../inventory/supplier-discount-rules/supplier-discount-rule.types";
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
import InvoiceFiscalItem from "../invoice-fiscal-item/invoice-fiscal-item.model";
import eventService from "../../../../company/events/event/event.service";
import redisService from "../../../../../shared/utils/base-models/base-redis";
import InvoiceUnitBusinessAttributes from "../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import { BlingApiFetchQueue } from "../../../../handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { TCarUpsertQueue } from "../../../../handlers/tecinco/queues/tecinco-api-fetch.queue";
import userService from "../../../../company/users/users/user.service";
import {
  decryptXml,
  isEncrypted,
} from "../../../../../shared/utils/xml/xml-cipher";
import Brand from "../../../../inventory/brands/brands.model";
import Rim from "../../../../inventory/rims/rim.model";
import TireMeasure from "../../../../inventory/tire-measures/tire-measure.model";
import { resolveTecincoBranchId } from "../../../../../shared/utils/tecinco/resolve-branch-id";

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

        // Fila de embarque Mercado Livre: 4 abas mutuamente exclusivas da
        // mesma tela ("o que precisa/já foi embarcado hoje"). Todas exigem
        // loja MercadoLivre + pedido (`order`, via Invoice.hasOne) — "hoje"
        // aqui não é só `collection_date` de hoje: uma nota já emitida
        // (antes do horário-limite de embarque) ou com lote finalizado hoje
        // também conta, mesmo com `collection_date` num dia futuro. Ver
        // `helpers/custom-filters.ts` pra definição completa de cada uma.
        pending_mercado_livre: (value) =>
          value === "true" ? pendingMercadoLivreWhere("MercadoLivre") : {},

        all_today_mercado_livre: (value) =>
          value === "true" ? allTodayMercadoLivreWhere("MercadoLivre") : {},

        finished_mercado_livre: (value) =>
          value === "true" ? finishedMercadoLivreWhere("MercadoLivre") : {},

        dispatched_mercado_livre: (value) =>
          value === "true" ? dispatchedMercadoLivreWhere("MercadoLivre") : {},

        // Notas com algum item cujo produto tem um dos aros informados —
        // aceita um id só ou array (qualquer um dos aros, não todos).
        rim: (value) =>
          productRimWhere((Array.isArray(value) ? value : [value]).filter(Boolean)),

        // Notas com algum item que REALMENTE recebeu o desconto de uma das
        // regras informadas (não só "se encaixaria no escopo dela") — ver
        // `supplierDiscountMatchWhere` pra detalhe.
        supplier_discount: (value) =>
          supplierDiscountMatchWhere(
            (Array.isArray(value) ? value : [value]).filter(Boolean),
          ),
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

  /**
   * Cria os InvoiceItems (+ InvoiceFiscalItem) que ainda não existem numa
   * invoice JÁ existente — usado no reprocesso de itens que ficaram
   * "não mapeados" na primeira passagem e só resolveram a um Product depois
   * (ex.: alguém concilia o produto no Bling e o webhook reenvia a nota).
   * Ignora silenciosamente qualquer item cujo product_id já tenha um
   * InvoiceItems OU InvoiceFiscalItem pra essa invoice — duas notas Tecinco
   * podem legitimamente resolver códigos internos diferentes pro mesmo
   * product_id (auto-map por SKU/EAN), então checar só InvoiceItems deixava
   * passar um product_id que já tinha InvoiceFiscalItem (ex.: de uma
   * passagem anterior que falhou depois de criar o fiscal item mas antes de
   * concluir), estourando a constraint única (invoice_id, product_id) no
   * insert em vez de ser ignorado aqui.
   * Retorna os product_id efetivamente criados.
   */
  async addMissingInvoiceItems(
    invoiceId: string,
    items: ItemWithFiscal[],
    transaction?: Transaction,
  ): Promise<string[]> {
    if (!items.length) return [];

    const t = transaction ?? (await sequelize.transaction());
    const isExternalTransaction = !!transaction;

    try {
      const productIds = items.map((i) => i.product_id);
      const [existingItems, existingFiscalItems] = await Promise.all([
        InvoiceItems.findAll({
          where: { invoice_id: invoiceId, product_id: { [Op.in]: productIds } },
          transaction: t,
        }),
        InvoiceFiscalItem.findAll({
          where: { invoice_id: invoiceId, product_id: { [Op.in]: productIds } },
          transaction: t,
        }),
      ]);
      const existingProductIds = new Set([
        ...existingItems.map((i) => i.product_id),
        ...existingFiscalItems.map((i) => i.product_id),
      ]);

      const newItems = items
        .filter((item) => !existingProductIds.has(item.product_id))
        .reduce<ItemWithFiscal[]>((acc, item) => {
          const dup = acc.find((i) => i.product_id === item.product_id);
          if (dup) {
            dup.quantity_expected = Math.trunc(
              dup.quantity_expected + item.quantity_expected,
            );
          } else {
            acc.push({ ...item });
          }
          return acc;
        }, []);

      if (!newItems.length) {
        if (!isExternalTransaction) await t.commit();
        return [];
      }

      const invoiceItems = newItems.map(({ fiscal: _, ...itemData }) => ({
        ...itemData,
        invoice_id: invoiceId,
      }));
      await this.repository.createInvoiceItems(invoiceItems, t);

      const fiscalItems = newItems
        .map(({ fiscal, ...itemData }, index) =>
          fiscal
            ? {
                ...fiscal,
                invoice_id: invoiceId,
                item_number: fiscal.item_number ?? index + 1,
              }
            : null,
        )
        .filter(Boolean) as InvoiceFiscalItemCreationAttributes[];
      if (fiscalItems.length > 0) {
        await this.repository.createInvoiceFiscalItems(fiscalItems, t);
      }

      if (!isExternalTransaction) await t.commit();
      return newItems.map((i) => i.product_id);
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

  async findByIdFullForAllUnits(
    id?: string,
    xml_key?: string,
    id_system?: string,
  ) {
    return this.repository.getFullInvoiceForAllUnits(id, xml_key, id_system);
  }

  // Usado pelos relatórios (getInvoiceProductReport/getInvoiceSupplierReport)
  // pra trazer o desconto de fornecedor por linha. O snapshot
  // (SalesOrderItemSnapshot, sem repository/service próprio — ver nota em
  // invoice.repository.ts) é keyed por (order_id, product_id), não por
  // invoice_item_id, então a chave do lookup precisa ser essa mesma
  // combinação — quem chama monta a chave `${orderId}|${productId}` pra
  // consultar o Map devolvido.
  private async buildSupplierDiscountLookup(
    orderIds: (string | undefined)[],
  ): Promise<
    Map<string, { value: number; ruleId: string | null; ruleName: string | null }>
  > {
    const uniqueOrderIds = [
      ...new Set(orderIds.filter((id): id is string => !!id)),
    ];
    if (!uniqueOrderIds.length) return new Map();

    const discountRows =
      await this.repository.findSupplierDiscountsByOrderIds(uniqueOrderIds);

    const ruleIds = [
      ...new Set(
        discountRows
          .map((row) => row.supplier_discount_rule_id)
          .filter((id): id is string => !!id),
      ),
    ];
    const rules = ruleIds.length
      ? await supplierDiscountRuleService.findManyDetailedByIds(ruleIds)
      : [];
    const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));

    // Uma venda por KIT é registrada em `sales_order_item_snapshots` com o
    // `product_id` do KIT, mas a nota fiscal emite o(s) produto(s)
    // COMPONENTE (a NF-e não tem "kit" como item, tem os pneus físicos) —
    // sem isso, nenhuma venda via kit encontraria seu desconto aqui, que é
    // o caso normal pra pneus (regras de desconto são tipicamente "a cada 2
    // pneus", vendidos como kit). Expande cada linha de kit pros ids dos
    // seus componentes, apontando pro mesmo valor/regra.
    const kitProductIds = [
      ...new Set(
        discountRows.map((row) => row.product_id).filter((id): id is string => !!id),
      ),
    ];
    const kitComponents = kitProductIds.length
      ? await this.repository.findKitComponentsByKitIds(kitProductIds)
      : [];
    const componentIdsByKitId = new Map<string, string[]>();
    for (const kc of kitComponents) {
      const arr = componentIdsByKitId.get(kc.product_kit_id) ?? [];
      arr.push(kc.product_component_id);
      componentIdsByKitId.set(kc.product_kit_id, arr);
    }

    const lookup = new Map<
      string,
      { value: number; ruleId: string | null; ruleName: string | null }
    >();
    for (const row of discountRows) {
      if (!row.product_id) continue;
      const entry = {
        value: Number(row.supplier_discount_value ?? 0),
        ruleId: row.supplier_discount_rule_id ?? null,
        ruleName: row.supplier_discount_rule_id
          ? (ruleNameById.get(row.supplier_discount_rule_id) ?? null)
          : null,
      };
      lookup.set(`${row.order_id}|${row.product_id}`, entry);
      for (const componentId of componentIdsByKitId.get(row.product_id) ?? []) {
        lookup.set(`${row.order_id}|${componentId}`, entry);
      }
    }
    return lookup;
  }

  async listInvoices(
    params: QueryParams,
    unitBusinessId: string,
  ): Promise<PaginatedResult<FullInvoiceAttributes>> {
    return this.repository.listInvoices(params, unitBusinessId, this.queryConfig);
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
    // `supplier_discount` sai do `where` da query e vira filtro pós-fetch
    // (mais abaixo) — o customField padrão só bate no desconto REAL
    // (`sales_order_item_snapshots`), que excluiria de cara qualquer nota
    // que só se qualifica via o bypass "ignora unit_business" deste
    // relatório. Sem tirar daqui, uma nota fora do escopo de loja da regra
    // nunca chegaria a ser buscada pra o bypass sequer ter a chance de
    // calcular seu desconto.
    const rawSupplierDiscountFilter = params.filters?.supplier_discount;
    const supplierDiscountRuleIdsFilter = (
      Array.isArray(rawSupplierDiscountFilter)
        ? rawSupplierDiscountFilter
        : rawSupplierDiscountFilter
          ? [rawSupplierDiscountFilter]
          : []
    ).filter(Boolean);

    const { supplier_discount: _supplierDiscountFilter, ...restFilters } =
      params.filters ?? {};
    const queryParams: QueryParams = {
      ...params,
      filters: restFilters,
    };

    const rows = await this.findAll(
      {
        subQuery: false,
        attributes: [
          "id",
          "id_system",
          "destination_city",
          "receiver_name",
          "number_system",
          "seller_id",
          "invoice_value",
          "emitted_at",
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
                // `id` precisa estar explícito aqui — um include com
                // `attributes` explícito não traz a PK de graça (achado
                // testando o `supplier_discount_value`/nome da regra: sem
                // isso, `item.product.id` vinha `undefined` e a correlação
                // com o desconto nunca batia).
                attributes: ["id", "line"],
                required: true,
                include: [
                  {
                    model: Brand,
                    as: "brandRegister",
                    required: false,
                  },
                  {
                    model: Rim,
                    as: "rimRegister",
                    required: false,
                  },
                  {
                    model: TireMeasure,
                    as: "measureRegister",
                    required: false,
                  },
                ],
              },
            ],
          },
          // Só pra permitir o customField `supplier_discount` filtrar por
          // `$order.unit_business_id$`/`$order.date$` — LEFT JOIN
          // inofensivo quando o filtro não está em uso, igual o de
          // `invoice.repository.ts`'s `listInvoices`.
          {
            model: Order,
            as: "order",
            attributes: ["id", "date", "unit_business_id"],
          },
        ],
      },
      queryParams,
      this.queryConfig,
    );

    const supplierDiscountLookup = await this.buildSupplierDiscountLookup(
      rows.map((invoice) => (invoice as Invoice & { order?: Order | null }).order?.id),
    );

    // Regra específica DESTE relatório, pedido explícito do usuário: mesmo
    // fora do escopo de unit_business da regra, ou sem Order vinculado (ou
    // com Order mas sem desconto real registrado), mostra o desconto que a
    // nota TERIA recebido — pool por NOTA (não por pedido), só regras REAL.
    // Dado só de leitura: não persiste nada, não afeta o motor real de
    // desconto/vendas. Só entra em jogo quando `supplierDiscountLookup`
    // (acima) não achou um valor > 0 pra esse item — nunca sobrescreve um
    // desconto real já encontrado. Ver
    // `supplierDiscountRuleService.resolveRealDiscountsIgnoringUnitBusiness`.
    const bypassItems: SupplierDiscountBypassItemInput[] = [];
    for (const invoice of rows) {
      const invoiceWithRelations = invoice as Invoice & {
        items?: (InvoiceItems & { product?: Product | null })[];
        order?: Order | null;
      };
      const referenceDate = invoiceWithRelations.order?.date ?? invoice.emitted_at;
      if (!referenceDate) continue;

      for (const item of invoiceWithRelations.items ?? []) {
        if (!item.product?.id) continue;
        bypassItems.push({
          item_id: `${invoice.id}|${item.product.id}`,
          pool_id: invoice.id,
          brand_id: item.product.brandRegister?.id ?? null,
          rim_id: item.product.rimRegister?.id ?? null,
          measure_id: item.product.measureRegister?.id ?? null,
          reference_date: referenceDate,
          real_quantity: item.quantity_expected,
        });
      }
    }
    const supplierDiscountBypassLookup =
      await supplierDiscountRuleService.resolveRealDiscountsIgnoringUnitBusiness(
        bypassItems,
      );

    const default_report_seler = await userService.findOne({
      where:{
        name: 'Rafael Minetto'
      }
    });

    const default_seller_body = {
      id: default_report_seler!.id,
      name: default_report_seler!.name,
      id_system: "",
    };

    const result: {
      number_system: string | undefined;
      seller: {
        id: string;
        name: string;
        id_system: string;
      } | null;
      customer: {
        name: string | null;
        city: string | null;
      };
      date: Date | null;
      measure: string | null;
      quantity: number;
      rim: string | null;
      line: string | null;
      brand: string | null;
      value: number | null;
      supplier_discount_value: number;
      supplier_discount_rule_name: string | null;
    }[] = [];

    for (const invoice of rows) {
      const invoiceWithRelations = invoice as Invoice & {
        seller?: Contact | null;
        items?: (InvoiceItems & { product?: Product | null })[];
        order?: Order | null;
      };

      const orderId = invoiceWithRelations.order?.id;

      for (const item of invoiceWithRelations.items ?? []) {
        const discount =
          orderId && item.product?.id
            ? supplierDiscountLookup.get(`${orderId}|${item.product.id}`)
            : undefined;
        const bypassDiscount = item.product?.id
          ? supplierDiscountBypassLookup.get(`${invoice.id}|${item.product.id}`)
          : undefined;
        // Só usa o bypass quando o lookup "real" não achou nada com valor
        // > 0 — nunca sobrescreve um desconto real já encontrado.
        const effectiveDiscount =
          discount && discount.value > 0 ? discount : bypassDiscount;

        // Filtro `supplier_discount` aplicado aqui (pós-fetch), não no
        // `where` da query — ver comentário no início do método. Com o
        // filtro ativo, só entra no resultado o item cujo desconto
        // efetivo (real OU bypass) veio de uma das regras selecionadas.
        if (
          supplierDiscountRuleIdsFilter.length > 0 &&
          !(
            effectiveDiscount?.ruleId &&
            supplierDiscountRuleIdsFilter.includes(effectiveDiscount.ruleId)
          )
        ) {
          continue;
        }

        result.push({
          number_system: invoice.number_system,
          seller: invoiceWithRelations.seller
            ? {
                id: invoiceWithRelations.seller.id,
                name: invoiceWithRelations.seller.name,
                id_system: invoiceWithRelations.seller.id_system,
              }
            : default_seller_body,
          customer: {
            name: invoice.receiver_name ?? null,
            city: invoice.destination_city ?? null,
          },
          date: invoice.emitted_at ?? null,
          measure: item.product?.measureRegister?.value ?? null,
          rim: item.product?.rimRegister?.value ?? null,
          quantity: item.quantity_expected,
          line: item.product?.line ?? null,
          brand: item.product?.brandRegister?.name ?? null,
          value: invoice.invoice_value ?? null,
          supplier_discount_value: effectiveDiscount?.value ?? 0,
          supplier_discount_rule_name: effectiveDiscount?.ruleName ?? null,
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
                // `id` explícito — sem isso `item.product.id` vem
                // `undefined` e a correlação com o desconto nunca bate
                // (mesmo achado de getInvoiceProductReport).
                attributes: ["id", "name", "brand"],
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
          // Só pra permitir o customField `supplier_discount` filtrar por
          // `$order.unit_business_id$`/`$order.date$` — LEFT JOIN
          // inofensivo quando o filtro não está em uso, igual o de
          // `invoice.repository.ts`'s `listInvoices`.
          {
            model: Order,
            as: "order",
            attributes: ["id", "date", "unit_business_id"],
          },
        ],
      },
      params,
      this.queryConfig,
    );

    const supplierDiscountLookup = await this.buildSupplierDiscountLookup(
      rows.map((invoice) => (invoice as Invoice & { order?: Order | null }).order?.id),
    );

    const result: {
      number_system: string | undefined;
      date: Date | null;
      xml_key: string | null;
      sku: string | null;
      description: string | null;
      quantity: number;
      brand: string | null;
      supplier_discount_value: number;
      supplier_discount_rule_name: string | null;
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
        order?: Order | null;
      };

      const orderId = invoiceWithRelations.order?.id;

      for (const item of invoiceWithRelations.items ?? []) {
        const product = item.product;
        const productConfig = product?.productConfigs?.[0];
        const discount =
          orderId && product?.id
            ? supplierDiscountLookup.get(`${orderId}|${product.id}`)
            : undefined;

        result.push({
          number_system: invoice.number_system,
          date: invoice.emitted_at ?? null,
          xml_key: invoice.xml_key ?? null,
          sku: productConfig?.sku ?? null,
          description: product?.name ?? "",
          quantity: item.quantity_expected,
          brand: product?.brand ?? null,
          supplier_discount_value: discount?.value ?? 0,
          supplier_discount_rule_name: discount?.ruleName ?? null,
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

  /**
   * Importa uma NF-e a partir de um XML enviado manualmente. Roda sempre
   * de forma síncrona (nunca enfileira), pra que um erro no processamento
   * propague de verdade pro chamador em vez de só ser logado por um worker
   * em background.
   */
  async importInvoiceXml(params: {
    integration?: string;
    xmlContent: string;
    userId?: string;
    blingQueue: BlingApiFetchQueue;
    tecincoQueue: TCarUpsertQueue;
  }): Promise<void> {
    const { integration, xmlContent, userId, blingQueue, tecincoQueue } =
      params;

    if (integration === "bling") {
      await blingQueue.upsertInvoiceFromXml(xmlContent);
    } else if (integration === "tecinco") {
      const branchId = await resolveTecincoBranchId(userId);
      if (!branchId) {
        throw new Error(
          "Não foi possível resolver a filial do usuário para importar via Tecinco",
        );
      }
      await tecincoQueue.upsertInvoiceFromXml(xmlContent, branchId);
    } else {
      throw new Error(`Integração inválida ou ausente: ${integration ?? "(nenhuma)"}`);
    }
  }

}

export default new InvoiceService();
