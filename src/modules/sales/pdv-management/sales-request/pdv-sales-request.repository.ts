import { Op, WhereOptions, fn, col, literal } from "sequelize";
import { saleInvoiceTransporterCdExpression } from "./helpers/transporter-cd";
import {
  hasReceiptLiteral,
  saleInvoiceCd21BatchStageCaseLiteral,
  saleInvoiceCd21BatchStageLiteral,
  saleInvoiceTransporterSelectorLiteral,
} from "./helpers/custom-filters";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import PdvSalesRequest from "./pdv-sales-request.model";
import {
  PdvBatchTarget,
  PdvBatchTargetFilter,
  PdvSalesRequestStatus,
  PdvShippingType,
  TERMINAL_PDV_SALES_REQUEST_STATUSES,
} from "./pdv-sales-request.types";
import Order from "../../orders/order/orders.model";
import Customer from "../../customers/customers.model";
import { PAYMENTS_INCLUDE } from "../../orders/order_payment/helpers/payments-include";
import OrderItems from "../../orders/order_items/order_items.model";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import Invoice from "../../../warehouse/fiscal/invoices/invoice/invoice.model";
import PdvSalesRequestReceipt from "../sales-request-receipt/pdv-sales-request-receipt.model";

// Detalhe (GET /:id) — só o que helpers/card-serializers.ts::toSalesRequestDetail
// usa. order.id/integrations_id/actual_situation/invoice_id/source_payload são
// internos (agrupar payments/items, status Bling, expedição, parcelas) e não saem.
const DETAIL_ATTRIBUTES = [
  "id",
  "unit_business_id",
  "order_id",
  "status",
  "shipping_type",
  "shipping_address",
  "transporter_name",
  "correction_origin_status",
  "errors",
  "origin",
  "sale_invoice_id",
  "transfer_invoice_id",
  "payment_receipt_analysis",
  "payment_receipt_validated",
  "payment_method_matches_receipt",
  "receipt_total_matches_order",
  "receipt_total_difference",
  "transfer_invoice_products_match_sale",
];

export class PdvSalesRequestRepository extends BaseRepository<PdvSalesRequest> {
  constructor() {
    super(PdvSalesRequest);
  }

  async findByIdWithOrder(id: string): Promise<PdvSalesRequest | null> {
    return this.findById(id, {
      attributes: DETAIL_ATTRIBUTES,
      include: [
        {
          model: Order,
          as: "order",
          attributes: [
            "id",
            "number_order_system",
            "number_order_channel",
            "date",
            "net_total_order",
            "integrations_id",
            "actual_situation",
            "invoice_id",
            "source_payload",
          ],
          include: [
            { model: Customer, as: "customer", attributes: ["name", "document"] },
            PAYMENTS_INCLUDE,
            { model: UnitBusiness, as: "unitBusiness", attributes: ["number", "name"] },
            {
              model: OrderItems,
              as: "items",
              attributes: ["id", "name", "sku", "quantity", "price"],
            },
          ],
        },
        {
          model: Invoice,
          as: "saleInvoice",
          attributes: ["id", "number_system", "transporter_name", "tracking_url"],
        },
        { model: Invoice, as: "transferInvoice", attributes: ["id", "number_system"] },
        {
          model: PdvSalesRequestReceipt,
          as: "receipts",
          attributes: ["id", "analysis"],
        },
      ],
    });
  }

  // Uma página de uma coluna do quadro — `where` já vem montado pela service
  // (escopo + filtros + status da coluna + cursor). Só belongsTo no include:
  // sem hasMany o LIMIT não cai no modo subQuery. Busca limit + 1 pra hasMore.
  async findBoardColumnPage(
    where: WhereOptions,
    limit: number,
  ): Promise<PdvSalesRequest[]> {
    return this.findAll({
      where,
      limit: limit + 1,
      order: [
        ["createdAt", "ASC"],
        ["id", "ASC"],
      ],
      attributes: [
        "id",
        "status",
        "shipping_type",
        "correction_origin_status",
        [literal('"PdvSalesRequest"."created_at"::text'), "cursor_created_at"],
        [hasReceiptLiteral(), "has_receipt"],
        [saleInvoiceCd21BatchStageCaseLiteral(), "batch_stage"],
      ],
      include: [
        {
          model: Order,
          as: "order",
          attributes: ["id", "number_order_system", "number_order_channel", "date"],
          include: [
            { model: Customer, as: "customer", attributes: ["name"] },
            { model: UnitBusiness, as: "unitBusiness", attributes: ["number"] },
          ],
        },
        {
          model: Invoice,
          as: "saleInvoice",
          attributes: ["transporter_name", "tracking_url"],
        },
      ],
    });
  }

  async findActiveByOrderId(orderId: string): Promise<PdvSalesRequest | null> {
    return this.findOne({
      where: {
        order_id: orderId,
        status: { [Op.notIn]: TERMINAL_PDV_SALES_REQUEST_STATUSES },
      },
    });
  }

  // Qualquer status, inclusive terminal — usado pela auto-criação
  // (createEmptyRequestForNewOrderIfEligible) pra nunca criar uma segunda
  // solicitação pro mesmo pedido, mesmo depois que a primeira já terminou
  // (FINISHED/CANCELLED/etc.). Diferente de findActiveByOrderId, que só
  // bloqueia duplicidade de solicitação ainda em andamento.
  async findByOrderId(orderId: string): Promise<PdvSalesRequest | null> {
    return this.findOne({ where: { order_id: orderId } });
  }

  // Mais recente pro pedido, qualquer status — usado por
  // reactivateIfCancelledByOrder pra só mexer na última solicitação.
  async findLatestByOrderId(orderId: string): Promise<PdvSalesRequest | null> {
    return this.findOne({
      where: { order_id: orderId },
      attributes: ["id", "status"],
      order: [["createdAt", "DESC"]],
    });
  }

  async findActiveBySaleOrTransferInvoiceId(
    invoiceId: string,
  ): Promise<PdvSalesRequest[]> {
    return this.findAll({
      where: {
        [Op.or]: [
          { sale_invoice_id: invoiceId },
          { transfer_invoice_id: invoiceId },
        ],
        status: { [Op.notIn]: TERMINAL_PDV_SALES_REQUEST_STATUSES },
      },
    });
  }

  // Candidatas ao auto-finish (finishIfDeliveryNoteGenerated) — qualquer
  // status ativo, só pela nota de VENDA (romaneio da transferência não finaliza).
  async findActiveBySaleInvoiceIds(
    invoiceIds: string[],
    attributes?: string[],
  ): Promise<PdvSalesRequest[]> {
    if (!invoiceIds.length) return [];

    return this.findAll({
      where: {
        sale_invoice_id: { [Op.in]: invoiceIds },
        status: { [Op.notIn]: TERMINAL_PDV_SALES_REQUEST_STATUSES },
      },
      ...(attributes && { attributes }),
    });
  }

  // order_id de toda PdvSalesRequest existente, opcionalmente restrita a um
  // conjunto de status — usado pra cruzar contra order.id em filtros de
  // outra entidade (ex.: force-update em massa por "tem/não tem PDV
  // request" + status do PDV), sem fazer join com Order aqui.
  async findOrderIdsByStatus(
    statuses?: PdvSalesRequestStatus[],
  ): Promise<string[]> {
    const rows = await this.model.findAll({
      where: statuses?.length ? { status: { [Op.in]: statuses } } : {},
      attributes: ["order_id"],
      raw: true,
    });

    return rows.map((r: any) => r.order_id);
  }

  // Contagem por status, agrupada em uma query só — base de getStatusSummary
  // (pdv-sales-request.service.ts). `where` já vem com o escopo de loja
  // aplicado (unit_business_id).
  async countGroupedByStatus(
    where: WhereOptions,
  ): Promise<Partial<Record<PdvSalesRequestStatus, number>>> {
    const rows = (await this.model.findAll({
      where,
      attributes: ["status", [fn("COUNT", col("id")), "quantity"]],
      group: ["status"],
      raw: true,
    })) as unknown as { status: PdvSalesRequestStatus; quantity: string }[];

    return rows.reduce<Partial<Record<PdvSalesRequestStatus, number>>>(
      (acc, row) => {
        acc[row.status] = Number(row.quantity);
        return acc;
      },
      {},
    );
  }

  // SHIPPING + shipping_type ADT agrupado pelo CD da transportadora da nota de
  // venda ("12"/"17"/outro; chave "" sem nota ou sem CD no nome) — indicativos
  // adt_12/adt_17/pending_expedition de getStatusSummary.
  async countAdtShippingGroupedByTransporterCd(
    where: WhereOptions,
  ): Promise<Record<string, number>> {
    const cd = saleInvoiceTransporterCdExpression();
    const rows = (await this.model.findAll({
      where: {
        ...where,
        status: PdvSalesRequestStatus.SHIPPING,
        shipping_type: PdvShippingType.ADT,
      },
      attributes: [[cd, "cd"], [fn("COUNT", col("id")), "quantity"]],
      group: [cd as any],
      raw: true,
    })) as unknown as { cd: string | null; quantity: string }[];

    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.cd ?? ""] = Number(row.quantity);
      return acc;
    }, {});
  }

  // Ids num status com nota de venda da transportadora (e no estágio de lote, se informado), mais antigas primeiro.
  async findBatchTargets(filter: PdvBatchTargetFilter): Promise<PdvBatchTarget[]> {
    const rows = await this.model.findAll({
      where: {
        ...(filter.ids && { id: { [Op.in]: filter.ids } }),
        ...(filter.status && { status: filter.status }),
        [Op.and]: [
          ...(filter.transporter
            ? [saleInvoiceTransporterSelectorLiteral(filter.transporter)]
            : []),
          ...(filter.batchStage
            ? [saleInvoiceCd21BatchStageLiteral(filter.batchStage)]
            : []),
        ],
      },
      attributes: [
        "id",
        "sale_invoice_id",
        [col("order.number_order_system"), "order_number"],
        [col("saleInvoice.transporter_id"), "transporter_id"],
        [col("saleInvoice.transporter_name"), "transporter_name"],
      ],
      include: [
        { model: Order, as: "order", attributes: [], required: false },
        { model: Invoice, as: "saleInvoice", attributes: [], required: false },
      ],
      order: [["createdAt", "ASC"]],
      raw: true,
    });
    return rows as unknown as PdvBatchTarget[];
  }

  // transporter_id distintos das notas de venda das solicitações do `where` (sem nota/transportadora fica fora).
  async findSaleInvoiceTransporterIds(where: WhereOptions): Promise<string[]> {
    const rows = (await this.model.findAll({
      where,
      attributes: [[col("saleInvoice.transporter_id"), "transporter_id"]],
      include: [
        {
          model: Invoice,
          as: "saleInvoice",
          attributes: [],
          required: true,
          where: { transporter_id: { [Op.ne]: null } },
        },
      ],
      group: [col("saleInvoice.transporter_id")],
      raw: true,
    })) as unknown as { transporter_id: string }[];

    return rows.map((row) => row.transporter_id);
  }

  // Contagem por correction_origin_status, restrita a PENDING_CORRECTION
  // (único status onde essa coluna é relevante) — sub_stats de
  // getStatusSummary.
  async countGroupedByCorrectionOrigin(
    where: WhereOptions,
  ): Promise<Partial<Record<PdvSalesRequestStatus, number>>> {
    const rows = (await this.model.findAll({
      where: { ...where, status: PdvSalesRequestStatus.PENDING_CORRECTION },
      attributes: [
        "correction_origin_status",
        [fn("COUNT", col("id")), "quantity"],
      ],
      group: ["correction_origin_status"],
      raw: true,
    })) as unknown as {
      correction_origin_status: PdvSalesRequestStatus | null;
      quantity: string;
    }[];

    return rows.reduce<Partial<Record<PdvSalesRequestStatus, number>>>(
      (acc, row) => {
        if (row.correction_origin_status) {
          acc[row.correction_origin_status] = Number(row.quantity);
        }
        return acc;
      },
      {},
    );
  }
}

export default new PdvSalesRequestRepository();
