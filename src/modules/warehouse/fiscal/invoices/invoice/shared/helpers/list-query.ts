import {
  FindOptions,
  Op,
  ProjectionAlias,
  Sequelize,
  WhereOptions,
} from "sequelize";
import { QueryParams } from "../../../../../../../shared/query/query.types";
import Invoice from "../../invoice.model";
import { FullInvoiceAttributes } from "../../invoice.types";
import InvoiceUnitBusinessAttributes from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import UnitBusiness from "../../../../../../company/unit-business/unit-business.model";
import ExpeditionBatchInvoice from "../../../../../expedition/batch-invoices/batch-invoices.model";
import ExpeditionBatch from "../../../../../expedition/batch/batch.model";
import Store from "../../../../../../sales/stores/stores.model";
import Order from "../../../../../../sales/orders/order/orders.model";
import Transporter from "../../../../../transporter/transporter.model";
import { Supplier } from "../../../../../../inventory";
import { totalExpectedLiteral, totalReadLiteral } from "./totals";
import { deliveryNoteGeneratedLiteral } from "./delivery-note";
import { batchInvoiceScopeWhere, batchTypesFromFilter } from "./batch-invoice-scope";

// Montagem das opções de query/mapeamento das listagens de nota (era privado do InvoiceRepository); usado por core e reports.
// Mesmo valor de MERCADO_LIVRE_STORE_NAME em orders.repository.ts — ainda
// não extraído pra um lugar compartilhado (mesma situação já assumida pra
// shippingWindowRange nos dois arquivos).
export const MERCADO_LIVRE_STORE_NAME = "MercadoLivre";

// Colunas que as telas de listagem (`GET /invoice`) leem.
export type ListedInvoiceQueryOptions = {
  extraOptions: Omit<FindOptions, "where" | "limit" | "offset" | "order">;
  forcedWhere: WhereOptions | undefined;
};

export const SUMMARY_INVOICE_ATTRIBUTES = [
  "id",
  "number_system",
  "emitted_at",
  "received_at",
  "expected_receiving",
  "customer_name",
  "sender_name",
  "receiver_name",
  "transfer_invoice_reference",
  "transfer_invoice_id",
  "return_invoice_reference",
  "transporter_name",
  "printed_label",
  "xml_key",
];

export function productBrandsLiteral() {
  return Sequelize.literal(`(
    SELECT ARRAY_AGG(DISTINCT p.brand)
    FROM invoice_items ii
    JOIN products p ON p.id = ii.product_id
    WHERE ii.invoice_id = "Invoice"."id"
      AND p.brand IS NOT NULL
  )`);
}

// ─── Helper: extrai filtros de invoice_unit_business_attributes ──────────────

export function extractAttrFilters(
  filters: QueryParams["filters"],
  unitBusinessId?: string,
): WhereOptions {
  const attrWhere: WhereOptions = unitBusinessId
    ? { unit_business_id: unitBusinessId }
    : {};

  if (filters?.status) {
    (attrWhere).status = Array.isArray(filters.status)
      ? { [Op.in]: filters.status }
      : filters.status;
    delete filters.status;
  }

  if (filters?.type) {
    (attrWhere).type = Array.isArray(filters.type)
      ? { [Op.in]: filters.type }
      : filters.type;
    delete filters.type;
  }

  if (filters?.batch_generated !== undefined) {
    (attrWhere).batch_generated = filters.batch_generated;
    delete filters.batch_generated;
  }

  if (filters?.processStatus !== undefined) {
    const val = filters.processStatus;
    delete filters.processStatus;

    if (val === "pendingProcess") {
      (attrWhere).status = { [Op.notIn]: ["FINISHED", "CANCELLED"] };
    } else if (val === "finishedProcess") {
      (attrWhere).batch_generated = true;
      (attrWhere).status = { [Op.in]: ["FINISHED", "CANCELLED"] };
    } else if (val === "notStartedProcess") {
      (attrWhere).status = { [Op.in]: ["OPEN", "PENDING"] };
      (attrWhere).batch_generated = false;
    }
  }

  return attrWhere;
}

// ─── Helper: extrai filtro de transporterStatus ──────────────────────────────
// `?filters[transporterStatus]=pending-<transporterId>` — usado pelos cards
// de "pendente por transportadora" (OrderService.getOrdersStatusSummary)
// pra abrir a listagem já filtrada pela mesma transportadora/status.

export function extractTransporterStatusFilter(
  filters: QueryParams["filters"],
): { attrWhere: WhereOptions; transporterId: string } | null {
  const value = filters?.transporterStatus;
  delete filters?.transporterStatus;

  if (typeof value !== "string") return null;

  const match = value.match(/^pending-(.+)$/);
  if (!match) return null;

  return {
    transporterId: match[1],
    attrWhere: {
      status: { [Op.in]: ["PENDING", "OPEN"] },
      batch_generated: false,
    },
  };
}

// ─── Helper: extrai filtro de batchStatus ───────────────────────────────────

export function extractBatchStatusFilter(
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

export function extractBrandFilter(
  filters: QueryParams["filters"],
): WhereOptions | null {
  if (!filters?.brand) return null;

  const value = filters.brand;
  delete filters.brand;

  // Marca vem do request — escapada pelo Sequelize, nunca interpolada crua.
  const condition = Array.isArray(value)
    ? `IN (${value.map((v: string) => Invoice.sequelize!.escape(v)).join(", ")})`
    : `= ${Invoice.sequelize!.escape(String(value))}`;

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

// Filtros que viram `where`/`required` nos includes — iguais em `GET /invoice` e na transferência.
// Sem `unitBusinessId`, attrs/batch só filtram quando algum filtro de attr/batch veio.
export function resolveListedInvoiceFilters(
  params: QueryParams,
  unitBusinessId?: string,
) {
  const transporterStatusFilter = extractTransporterStatusFilter(
    params.filters,
  );
  const attrWhere = {
    ...extractAttrFilters(params.filters, unitBusinessId),
    ...(transporterStatusFilter?.attrWhere ?? {}),
  };
  const hasAttrFilter = Object.keys(attrWhere).length > 0;
  const batchStatusWhere = extractBatchStatusFilter(params.filters);
  const batchTypes = batchTypesFromFilter((attrWhere as any).type);

  return {
    attrWhere: hasAttrFilter ? attrWhere : undefined,
    hasAttrFilter,
    // Vínculo nota→lote da loja; com filters[type], a nota de transbordo mostra o lote desse type.
    batchInvoiceWhere: batchInvoiceScopeWhere(unitBusinessId, batchTypes),
    // Um type só: total_read soma só os lotes dele (transbordo tem entrada e expedição na mesma loja).
    batchType:
      batchTypes.length === 1 ? (batchTypes[0] as "INCOMING" | "OUTGOING") : undefined,
    batchWhere: {
      ...(unitBusinessId ? { unit_business_id: unitBusinessId } : {}),
      ...(batchStatusWhere ?? {}),
    },
    hasBatchFilter: !!batchStatusWhere,
    storeRequired: !!transporterStatusFilter,
    storeWhere: transporterStatusFilter
      ? { name: { [Op.ne]: MERCADO_LIVRE_STORE_NAME } }
      : undefined,
    forcedWhere: transporterStatusFilter
      ? ({ transporter_id: transporterStatusFilter.transporterId } as WhereOptions)
      : undefined,
  };
}

export function listedInvoiceCalculatedAttributes(
  unitBusinessId?: string,
  batchType?: "INCOMING" | "OUTGOING",
): ProjectionAlias[] {
  return [
    [productBrandsLiteral(), "product_brands"],
    [totalExpectedLiteral(), "total_expected"],
    [totalReadLiteral(unitBusinessId, "Invoice", batchType), "total_read"],
  ];
}

// `GET /invoice`: só o que as telas de listagem leem. `order`/`supplier` com `attributes: []` ficam só pelos filtros.
export function buildListedInvoiceQueryOptions(
  params: QueryParams,
  unitBusinessId: string,
): ListedInvoiceQueryOptions {
  const filters = resolveListedInvoiceFilters(params, unitBusinessId);

  return {
    forcedWhere: filters.forcedWhere,
    extraOptions: {
      subQuery: false,
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: filters.attrWhere,
          required: filters.hasAttrFilter,
          attributes: ["status", "batch_generated", "danfe_printed"],
          include: [
            { model: UnitBusiness, as: "unitBusiness", attributes: ["number"] },
          ],
        },
        {
          model: ExpeditionBatchInvoice,
          as: "batchInvoice",
          required: filters.hasBatchFilter,
          attributes: ["id"],
          where: filters.batchInvoiceWhere,
          include: [
            {
              model: ExpeditionBatch,
              as: "batch",
              required: filters.hasBatchFilter,
              attributes: ["id", "number"],
              where: filters.batchWhere,
            },
          ],
        },
        {
          model: Store,
          as: "store",
          attributes: ["name"],
          required: filters.storeRequired,
          where: filters.storeWhere,
        },
        { model: Order, as: "order", attributes: [] },
        {
          model: Transporter,
          as: "transporter",
          attributes: ["name", "uf", "cnpj"],
        },
        { model: Supplier, as: "supplier", attributes: [] },
        {
          model: UnitBusiness,
          as: "originUnitBusiness",
          attributes: ["id", "name", "number", "cnpj"],
        },
      ],
      attributes: [
        ...SUMMARY_INVOICE_ATTRIBUTES,
        ...listedInvoiceCalculatedAttributes(unitBusinessId, filters.batchType),
      ],
    },
  };
}

// Transferência (`listTransferInvoices`/`findAllTransferInvoices`): projeção completa da nota.
export function buildTransferInvoiceQueryOptions(
  params: QueryParams,
  unitBusinessId?: string,
): ListedInvoiceQueryOptions {
  const filters = resolveListedInvoiceFilters(params, unitBusinessId);

  return {
    forcedWhere: filters.forcedWhere,
    extraOptions: {
      subQuery: false,
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          where: filters.attrWhere,
          required: filters.hasAttrFilter,
          attributes: [
            "status",
            "type",
            "batch_generated",
            "danfe_printed",
            "unit_business_id",
          ],
          include: [{ model: UnitBusiness, as: "unitBusiness" }],
        },
        {
          model: ExpeditionBatchInvoice,
          as: "batchInvoice",
          required: filters.hasBatchFilter,
          attributes: ["id"],
          where: filters.batchInvoiceWhere,
          include: [
            {
              model: ExpeditionBatch,
              as: "batch",
              required: filters.hasBatchFilter,
              attributes: ["number", "status", "mode", "id"],
              where: filters.batchWhere,
            },
          ],
        },
        {
          model: Store,
          as: "store",
          attributes: ["name"],
          required: filters.storeRequired,
          where: filters.storeWhere,
        },
        {
          model: Order,
          as: "order",
          attributes: ["id", "collection_date", "date", "unit_business_id"],
        },
        {
          model: Transporter,
          as: "transporter",
          attributes: ["name", "uf", "cnpj"],
        },
        { model: Supplier, as: "supplier", attributes: ["name"] },
        {
          model: UnitBusiness,
          as: "originUnitBusiness",
          attributes: ["id", "name", "number", "cnpj"],
        },
      ],
      attributes: {
        // observation só no detalhe por id, nunca em listagem.
        exclude: ["source_payload", "xml_path", "observation"],
        include: [
          ...listedInvoiceCalculatedAttributes(unitBusinessId, filters.batchType),
          [deliveryNoteGeneratedLiteral(), "delivery_note_generated"],
        ],
      },
    },
  };
}

export function mapListedInvoice(invoice: Invoice): FullInvoiceAttributes {
  const plain = invoice.get({ plain: true }) as any;
  return {
    ...plain,
    unitBusinessAttributes: plain.unitBusinessAttributes?.[0] ?? null,
    product_brands: plain.product_brands ?? [],
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
  } as unknown as FullInvoiceAttributes;
}

// Anexa o nome da loja de cada ponta (null quando o CNPJ não é de loja cadastrada); usado nas 3 listagens de transferência/interna.
export function withUnitBusinessNames(
  invoices: FullInvoiceAttributes[],
  nameByCnpj: Map<string, string>,
): FullInvoiceAttributes[] {
  return invoices.map((invoice) => ({
    ...invoice,
    sender_unit_business_name: nameByCnpj.get(invoice.sender_cnpj) ?? null,
    receiver_unit_business_name: nameByCnpj.get(invoice.receiver_cnpj) ?? null,
  }));
}
