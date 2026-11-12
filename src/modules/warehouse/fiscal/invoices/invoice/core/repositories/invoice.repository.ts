import {
  FullInvoice,
  FullInvoiceAttributes,
  FullInvoiceForAllUnits,
  FullInvoiceMappedForFrontend,
} from "../../invoice.types";
import { PendingBatchByTransporterRow } from "../types/core.types";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import UnmappedInvoiceProduct from "../../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import InvoiceItems from "../../../invoice-items/invoice-items.model";
import Invoice from "../../invoice.model";
import { Product, ProductConfig } from "../../../../../../inventory";
import { col, fn, FindOptions, Op, Sequelize } from "sequelize";
import ExpeditionBatchInvoice from "../../../../../expedition/batch-invoices/batch-invoices.model";
import BatchInvoiceItems from "../../../../../expedition/batch-invoice-items/batch-invoice-items.model";
import ExpeditionBatchItems from "../../../../../expedition/batch-items/batch-items.model";
import ExpeditionBatch from "../../../../../expedition/batch/batch.model";
import InvoiceUnitBusinessAttributes from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import UnitBusiness from "../../../../../../company/unit-business/unit-business.model";
import Transporter from "../../../../../transporter/transporter.model";
import Store from "../../../../../../sales/stores/stores.model";
import {
  PaginatedResult,
  QueryParams,
  QueryConfig,
} from "../../../../../../../shared/query/query.types";
import { BatchInvoiceItemsAttributes } from "../../../../../expedition/batch-invoice-items/batch-invoice-items.types";
import {
  MERCADO_LIVRE_STORE_NAME,
  batchInvoiceScopeWhere,
  buildListedInvoiceQueryOptions,
  buildTransferInvoiceQueryOptions,
  invoiceAttributesRepository,
  mapListedInvoice,
  notInternalInvoiceWhere,
  totalExpectedLiteral,
  totalReadLiteral,
  xmlHeadLiteral,
} from "../../shared";
import invoiceOperationRepository from "../../../invoice-operation/invoice-operation.repository";
import { INVOICE_OPERATION_CODES } from "../../../invoice-operation/invoice-operation.types";
import { LOGISTIC_OCCURRENCE_CODES } from "../../../../../../handlers/logistic/constants/constants";

// Consultas de leitura/listagem da nota fiscal (CRUD, detalhe e contagens); o resto fica nos domínios.
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

  async listInvoices(
    params: QueryParams,
    unitBusinessId: string,
    queryConfig: QueryConfig = {},
  ): Promise<PaginatedResult<FullInvoiceAttributes>> {
    const { extraOptions, forcedWhere } = buildListedInvoiceQueryOptions(
      params,
      unitBusinessId,
    );
    const internalOperationId = await invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);

    // Nota interna tem listagem própria (internal/), nunca aparece aqui.
    const result = await this.findPaginated(params, queryConfig, extraOptions, {
      ...forcedWhere,
      ...notInternalInvoiceWhere(internalOperationId),
    });

    return {
      ...result,
      data: result.data.map((invoice) => mapListedInvoice(invoice)),
    };
  }

  // Notas fiscais "de transferência" — remetente E destinatário são ambos
  // unit_businesses próprias (não um cliente/fornecedor externo). Resolve
  // isso comparando `sender_cnpj`/`receiver_cnpj` contra o conjunto de CNPJs
  // cadastrados em `unit_businesses`, não por um flag/tipo próprio na nota.
  // `unitBusinessId` é opcional (quem chama decide se filtra por uma loja
  // específica) — ausente, lista transferências de todas as unit businesses.
  async listTransferInvoices(
    params: QueryParams,
    unitBusinessId: string | undefined,
    queryConfig: QueryConfig = {},
  ): Promise<PaginatedResult<FullInvoiceAttributes>> {
    const [unitBusinessCnpjs, internalOperationId] = await Promise.all([
      invoiceAttributesRepository.findAllUnitBusinessCnpjs(),
      invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER),
    ]);

    const { extraOptions, forcedWhere } = buildTransferInvoiceQueryOptions(
      params,
      unitBusinessId,
    );

    // Nota interna também é entre lojas, mas tem listagem própria (internal/).
    const result = await this.findPaginated(params, queryConfig, extraOptions, {
      ...forcedWhere,
      sender_cnpj: { [Op.in]: unitBusinessCnpjs },
      receiver_cnpj: { [Op.in]: unitBusinessCnpjs },
      ...notInternalInvoiceWhere(internalOperationId),
    });

    return {
      ...result,
      data: result.data.map((invoice) => mapListedInvoice(invoice)),
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
          attributes: ["status", "type", "batch_generated", "unit_business_id"],
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
    idSystem?: string,
  ): Promise<FullInvoiceForAllUnits | null> {
    if (!invoiceId && !invoiceKey && !idSystem) {
      throw new Error(
        "É necessário informar invoiceId, invoiceKey ou idSystem.",
      );
    }

    const queryOptions: Omit<FindOptions, "where"> = {
      attributes: {
        exclude: ["xml_path", "source_payload"],
        include: [[totalExpectedLiteral(), "total_expected"]],
      },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: false,
          attributes: ["status", "type", "batch_generated", "unit_business_id"],
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
    };

    if (invoiceId) {
      const data = await this.findOne({
        where: { id: invoiceId },
        ...queryOptions,
      });
      return data ? (data.get({ plain: true }) as FullInvoiceForAllUnits) : null;
    }

    // xml_key (chaveAcesso da NF-e) é a chave fiscal única — busca por ela
    // primeiro e, se bater, é sempre autoritativa.
    if (invoiceKey) {
      const byKey = await this.findOne({
        where: { xml_key: invoiceKey },
        ...queryOptions,
      });
      if (byKey) return byKey.get({ plain: true }) as FullInvoiceForAllUnits;
    }

    if (idSystem) {
      const byIdSystem = await this.findOne({
        where: { id_system: idSystem },
        ...queryOptions,
      });
      // Só aceita o match por id_system se a linha não tiver um xml_key já
      // divergente do atual — evita tratar como "mesma nota" um id da Bling
      // reaproveitado (stub, retry, ou colisão entre NF-e/NFC-e) e colidir
      // com invoices_xml_key ao sobrescrever o xml_key da linha errada.
      if (
        byIdSystem &&
        (!byIdSystem.xml_key || byIdSystem.xml_key === invoiceKey)
      ) {
        return byIdSystem.get({ plain: true }) as FullInvoiceForAllUnits;
      }
    }

    return null;
  }

  // ─── Detalhe completo (com batch) ───────────────────────────────────────────

  // type opcional: na loja de transbordo a nota tem entrada e expedição — escolhe a linha de atributo e o lote desse type.
  async getFullInvoiceWithBatch(
    invoiceId: string,
    unitBusinessId: string,
    type?: "INCOMING" | "OUTGOING",
  ): Promise<FullInvoiceMappedForFrontend> {
    const data = await this.findById(invoiceId, {
      attributes: {
        exclude: ["xml_path", "source_payload"],
        include: [
          [totalExpectedLiteral(), "total_expected"],
          [totalReadLiteral(unitBusinessId, "Invoice", type), "total_read"],
          [xmlHeadLiteral(), "xml_head"],
        ],
      },
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: { unit_business_id: unitBusinessId, ...(type && { type }) },
          required: false,
          attributes: ["status", "type", "batch_generated", "unit_business_id"],
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
          where: batchInvoiceScopeWhere(unitBusinessId, type ? [type] : []),
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
                      attributes: ["name", "type", "brand"],
                      include: [
                        {
                          model: ProductConfig,
                          as: "productConfigs",
                          attributes: [
                            "product_id",
                            "sku",
                            "price",
                            "gtin",
                            "gtin_package",
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
        {
          model: UnitBusiness,
          as: "originUnitBusiness",
          attributes: ["id", "name", "number", "cnpj"],
        },
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

  // Notas cujo romaneio (delivery note) já foi gerado NA unit business
  // informada — via associação própria Invoice -> batchInvoice -> batch,
  // mesmo caminho de getFullInvoiceWithBatch. Escopo por unit_business_id é
  // obrigatório: uma mesma nota pode estar em lotes de mais de uma loja
  // (não há unique em expedition_batch_invoices.invoice_id — ver
  // generateBatchFromInvoices's "alreadyInBatch", que também escopa por
  // unit_business_id), então checar sem esse filtro daria falso positivo pro
  // romaneio de uma loja errada. Consumido pelo auto-finish do PDV (ver
  // pdv-sales-request.service.ts::finishIfDeliveryNoteGenerated).
  async findDeliveryNoteGeneratedInvoiceIds(
    invoiceIds: string[],
    unitBusinessId: string,
  ): Promise<string[]> {
    if (!invoiceIds.length) return [];

    const rows = await Invoice.findAll({
      where: { id: { [Op.in]: invoiceIds } },
      attributes: ["id"],
      include: [
        {
          model: ExpeditionBatchInvoice,
          as: "batchInvoice",
          required: true,
          attributes: [],
          include: [
            {
              model: ExpeditionBatch,
              as: "batch",
              required: true,
              attributes: [],
              where: {
                unit_business_id: unitBusinessId,
                delivery_note_generated_at: { [Op.ne]: null },
              },
            },
          ],
        },
      ],
    });

    return rows.map((row) => row.id);
  }

  // Notas PENDING/OPEN dessa unit business que ainda não entraram em
  // romaneio (batch_generated = false), agrupadas por transportadora —
  // usado pelo resumo de pedidos (OrderService.getOrdersStatusSummary).
  async countPendingBatchByTransporter(
    unitBusinessId: string,
  ): Promise<PendingBatchByTransporterRow[]> {
    const rows = (await this.model.findAll({
      subQuery: false,
      attributes: [
        "transporter_id",
        [col("transporter.name"), "transporter_name"],
        [fn("COUNT", col("Invoice.id")), "quantity"],
      ],
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: true,
          attributes: [],
          where: {
            unit_business_id: unitBusinessId,
            type: "OUTGOING",
            status: { [Op.in]: ["PENDING", "OPEN"] },
            batch_generated: false,
          },
        },
        {
          model: Transporter,
          as: "transporter",
          required: false,
          attributes: [],
        },
        // Exclui notas da loja Mercado Livre — pedidos ML têm fluxo de
        // envio próprio (ML-SCRAPING), esse contador é só pra romaneio
        // "normal" por transportadora.
        {
          model: Store,
          as: "store",
          required: true,
          attributes: [],
          where: { name: { [Op.ne]: MERCADO_LIVRE_STORE_NAME } },
        },
      ],
      group: ["Invoice.transporter_id", "transporter.id", "transporter.name"],
      raw: true,
    })) as unknown as Array<{
      transporter_id: string | null;
      transporter_name: string | null;
      quantity: string;
    }>;

    return rows.map((r) => ({
      transporter_id: r.transporter_id,
      transporter_name: r.transporter_name,
      quantity: Number(r.quantity),
    }));
  }
}

export default new InvoiceRepository();
