import {
  countInstallments,
  toPaymentsView,
} from "../../orders/order_payment/helpers/payments-view";
import { Op, WhereOptions } from "sequelize";
import { randomUUID } from "node:crypto";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import PdvSalesRequest from "./pdv-sales-request.model";
import pdvSalesRequestRepository, {
  PdvSalesRequestRepository,
} from "./pdv-sales-request.repository";
import {
  PdvCorrectionOrigin,
  PdvCorrectionReason,
  PdvSalesRequestErrors,
  PdvSalesRequestStatus,
  PdvShippingType,
  PdvSalesRequestOrigin,
  PaymentReceiptExtraction,
  PaymentReceiptPaymentMethod,
  PaymentReceiptReconciledAnalysis,
  EMPTY_PAYMENT_RECEIPT_EXTRACTION,
  PdvSalesRequestOrderDetail,
  PdvSalesRequestOrderSummary,
  PdvBoardColumnResult,
  PdvSalesRequestDetail,
  TERMINAL_PDV_SALES_REQUEST_STATUSES,
  EXPEDITION_PDV_SALES_REQUEST_STATUSES,
} from "./pdv-sales-request.types";
import pdvSalesRequestHistoryService from "../sales-request-history/pdv-sales-request-history.service";
import pdvSalesRequestReceiptService from "../sales-request-receipt/pdv-sales-request-receipt.service";
import PdvSalesRequestReceipt from "../sales-request-receipt/pdv-sales-request-receipt.model";
import { extractDanfeIdentification } from "./helpers/danfe-interpreter";
import { cleanDocument } from "../../../../shared/utils/normalizers/document";
import orderService from "../../orders/order/orders.service";
import paymentMethodService from "../../orders/payment_method/payment_method.service";
import expeditionBatchService from "../../../warehouse/expedition/batch/batch.service";
import { buildExpeditionProgress } from "./helpers/expedition-progress";
import invoiceService from "../../../warehouse/fiscal/invoices/invoice/invoice.service";
import invoiceItemsService from "../../../warehouse/fiscal/invoices/invoice-items/invoice-items.service";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import transporterService from "../../../warehouse/transporter/transporter.service";
import uploaderService from "../../../handlers/uploader/services/uploader.service";
import uploaderQueue from "../../../handlers/uploader/uploader.queue";
import { buildEntityCacheKey } from "../../../handlers/uploader/uploader-image-cache";
import tempFileService from "../../../handlers/temp-file/temp-file.service";
import {
  buildTempFileSentinelPath,
  isTempFileSentinelPath,
  extractTempFileId,
  resolveDeleteTarget,
} from "../../../handlers/temp-file/temp-file.constants";
import { getTCarIntegration } from "../../../handlers/tecinco/api/tecinco_api";
import { TCarInvoiceQueue } from "../../../handlers/tecinco/queues/tecinco-invoice.queue";
import { extractAccessKeyFromXmlContent } from "../../../../shared/utils/xml/access-key";
import nfeEmissionService from "../../../handlers/bling/services/bling-nfe/nfe-emission.service";
import paymentReceiptExtractionService from "./payment-receipt-extraction.service";
import {
  PaymentReceiptEditSchema,
  PaymentReceiptReconciledEditSchema,
} from "./helpers/payment-receipt-extraction.schema";
import {
  paymentMethodsMatchReceipts,
  receiptTypeFromPaymentMethod,
  resolvePaymentMethodForReceipt,
} from "./helpers/payment-method-match";
import {
  reconcileReceiptAnalyses,
  reconcileReceiptValidation,
  receiptTotalMatchesOrder,
  receiptTotalDifference,
} from "./helpers/receipt-reconciliation";
import { QueryParams } from "../../../../shared/query/query.types";
import { QueryParser } from "../../../../shared/query/query.parser";
import socketService from "../../../handlers/socket/services/socket.service";
import {
  PDV_SOCKET_NAMESPACE,
  pdvSalesRequestRoom,
  PAYMENT_RECEIPT_ANALYSIS_DONE_EVENT,
} from "./helpers/pdv-sales-request-room";
import {
  notifySalesRequestChanged,
  notifySalesRequestUpdated,
} from "./helpers/notify-sales-request-updated";
import { notifyPdvStoresSync } from "./helpers/notify-pdv-store-sync";
import {
  pickReceiptAnalysisFields,
  toBoardCard,
  toSalesRequestDetail,
} from "./helpers/card-serializers";
import { boardCursorAfterLiteral, encodeBoardCursor } from "./helpers/board-cursor";
import { PdvBoardQuery } from "./helpers/board-query";
import {
  PdvBoardColumn,
  findVisibleColumn,
  resolveBoardScreen,
  resolveColumns,
} from "../helpers/pdv-screens.config";
import { PdvForbiddenError } from "../helpers/pdv-errors";
import {
  ADT_TRANSPORTER_CDS,
  extractTransporterCd,
} from "./helpers/transporter-cd";
import { invoiceProductsMatch } from "./helpers/invoice-product-quantity-match";
import { PDV_EXCLUDED_STORE_NUMBERS } from "../helpers/pdv-excluded-unit-business";
import { isWithinPhysicalStoreRange } from "../../../company/unit-business/helpers/physical-numbered-unit-business";
import {
  orderNumberSystemMatchesLiteral,
  orderCustomerNameMatchesLiteral,
  orderDateWithinLiteral,
  errorsReasonsOverlapLiteral,
  pdvSalesRequestSearchLiteral,
} from "./helpers/custom-filters";
import {
  PDV_STATUS_INDICATORS,
  PDV_STATUS_INDICATORS_BY_SCREEN,
  PDV_CORRECTION_ORIGINS_BY_SCREEN,
  PdvStatusIndicatorKey,
  indicatorWhere,
} from "./helpers/status-summary";
import { PdvAccessContext, PdvAccessScreen } from "../pdv-access/pdv-access.types";

// Fingerprint duplicado em OUTRA solicitação — tipo próprio pra distinguir
// esse caso de qualquer outro erro dentro do job assíncrono de análise.
export class DuplicateReceiptError extends Error {}

// Teto de segurança pra findEligibleOrders — sem paginação própria ainda,
// ver .claude/entities/pdv-sales-request/index.md ("Card do Kanban").
const ELIGIBLE_ORDERS_LIMIT = null;

// Acima disso, o job assíncrono desiste e trata como falha de extração
// (financeiro revisa manualmente) em vez de deixar o front esperando
// indefinidamente — o OCR em si pode continuar rodando depois, só não é
// mais esperado por quem chamou.
const RECEIPT_ANALYSIS_TIMEOUT_MS = 5000;

export class PdvSalesRequestService extends BaseService<
  PdvSalesRequest,
  PdvSalesRequestRepository
> {
  constructor() {
    super(pdvSalesRequestRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "ASC" },
      filterableFields: [
        "status",
        "order_id",
        "unit_business_id",
        "shipping_type",
        "correction_origin_status",
        "origin",
      ],
      sortableFields: ["createdAt", "status"],
      customFields: {
        // EXISTS correlacionado contra orders — só um filtro isolado, não
        // precisa de método novo na repository (ver "list-filters" no CLAUDE.md).
        number_order_system: (value) => {
          const term = Array.isArray(value) ? value[0] : value;
          return { [Op.and]: [orderNumberSystemMatchesLiteral(String(term))] };
        },
        // Nome do cliente do pedido vinculado — mesmo espírito de
        // number_order_system (order não é coluna própria, EXISTS correlacionado).
        customer_name: (value) => {
          const term = Array.isArray(value) ? value[0] : value;
          return {
            [Op.and]: [orderCustomerNameMatchesLiteral(String(term))],
          };
        },
        // Período de order.date — mesmo formato { start, end } do filtro
        // genérico de range do QueryParser (ver query.parser.ts), só que via
        // EXISTS porque order.date não é coluna de PdvSalesRequest.
        date: (value) => {
          const range = (
            Array.isArray(value) ? {} : value
          ) as { start?: string; end?: string };
          return { [Op.and]: [orderDateWithinLiteral(range)] };
        },
        // errors.reasons é array dentro de JSONB — sem coluna própria pra
        // filtrar direto, precisa do literal jsonb (ver custom-filters.ts).
        reason: (value) => {
          const reasons = Array.isArray(value) ? value : [value];
          return {
            [Op.and]: [errorsReasonsOverlapLiteral(reasons.map(String))],
          };
        },
        // Filtra pelo mesmo critério que popula um indicativo de
        // getStatusSummary (ex.: filters[indicator]=cd21_billing) — nunca
        // duplicar o critério status/correction_origin_status de cada
        // indicativo, ver helpers/status-summary.ts.
        indicator: (value) => {
          const key = (Array.isArray(value) ? value[0] : value) as PdvStatusIndicatorKey;
          return indicatorWhere(key);
        },
      },
    };
  }

  // ─── Leitura enriquecida (card do Kanban) ────────────────────────────────────
  // Pedido (Bling) embutido na resposta — ver "Card do Kanban" em
  // .claude/entities/pdv-sales-request/index.md.

  private toOrderDetail(order: any): PdvSalesRequestOrderDetail | null {
    if (!order) return null;

    return {
      id: order.id,
      number_order_channel: order.number_order_channel,
      number_order_system: order.number_order_system ?? null,
      date: order.date ?? null,
      net_total_order: order.net_total_order ?? null,
      customer: order.customer
        ? {
            id: order.customer.id,
            name: order.customer.name,
            document: order.customer.document,
          }
        : null,
      unitBusiness: order.unitBusiness
        ? {
            id: order.unitBusiness.id,
            number: order.unitBusiness.number,
            name: order.unitBusiness.name,
          }
        : null,
      payments: toPaymentsView(order.payments),
      installments: countInstallments(order.source_payload),
      items: (order.items ?? []).map((item: any) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        quantity: item.quantity,
        price: item.price,
      })),
    };
  }

  private toOrderSummary(order: any): PdvSalesRequestOrderSummary | null {
    if (!order) return null;

    return {
      id: order.id,
      number_order_channel: order.number_order_channel,
      number_order_system: order.number_order_system ?? null,
      date: order.date ?? null,
      net_total_order: order.net_total_order ?? null,
      customer: order.customer
        ? { id: order.customer.id, name: order.customer.name, document: order.customer.document }
        : null,
      unitBusiness: order.unitBusiness
        ? {
            id: order.unitBusiness.id,
            number: order.unitBusiness.number,
            name: order.unitBusiness.name,
          }
        : null,
    };
  }

  // Detalhe (card expandido). Loja só abre card da própria loja — null
  // (404) pra card de outra; acesso global (unitBusinessId null) abre qualquer um.
  async findByIdWithOrder(
    id: string,
    access: PdvAccessContext,
  ): Promise<PdvSalesRequestDetail | null> {
    const record = await this.repository.findByIdWithOrder(id);
    if (!record) return null;
    if (
      access.unitBusinessId !== null &&
      record.unit_business_id !== access.unitBusinessId
    ) {
      return null;
    }

    const plain = record.get({ plain: true }) as any;
    const [resolveStatus, expeditionProgress, shippingInfoRequired] =
      await Promise.all([
        orderService.buildStatusResolver(
          plain.order ? [plain.order.integrations_id] : [],
        ),
        this.resolveExpeditionProgress(plain),
        this.isShippingInfoRequired(plain.order?.invoice_id ?? null),
      ]);

    return toSalesRequestDetail(plain, resolveBoardScreen(access), {
      orderStatus: plain.order
        ? resolveStatus(plain.order.integrations_id, plain.order.actual_situation)
        : null,
      expeditionProgress,
      shippingInfoRequired,
    });
  }

  // Só em SHIPPING/SHIP_TODAY; nota é order.invoice_id (fonte de verdade), sem nota = fora de lote.
  private async resolveExpeditionProgress(plain: any) {
    if (!EXPEDITION_PDV_SALES_REQUEST_STATUSES.includes(plain.status)) return null;

    const invoiceId = plain.order?.invoice_id ?? plain.sale_invoice_id;
    const batchStatus = invoiceId
      ? await expeditionBatchService.getBatchStatusByInvoiceId(invoiceId)
      : { in_batch: false, batch_finished: false, delivery_note_generated: false };
    return buildExpeditionProgress(batchStatus);
  }

  // Acesso global sem loja selecionada (CD21/Financeiro sempre, Televendas
  // quando não escolhe loja) — resolve pra "todas as lojas físicas normais"
  // (número 1-24, exceto CD21 e PDV_EXCLUDED_STORE_NUMBERS), nunca online/
  // marketplace. Ver unitBusinessService.getPhysicalNumberedUnitBusinessIds.
  private async resolveUnitBusinessScope(
    unitBusinessId: string | null,
  ): Promise<string | string[]> {
    if (unitBusinessId) return unitBusinessId;
    return unitBusinessService.getPhysicalNumberedUnitBusinessIds(
      PDV_EXCLUDED_STORE_NUMBERS,
    );
  }

  private async unitBusinessScopeWhere(
    unitBusinessId: string | null,
  ): Promise<WhereOptions> {
    const scope = await this.resolveUnitBusinessScope(unitBusinessId);
    return {
      unit_business_id: Array.isArray(scope) ? { [Op.in]: scope } : scope,
    };
  }

  // Loja explicitamente fora do fluxo PDV — diferente do caso "sem loja
  // selecionada" acima, aqui a loja É uma específica, só que uma que nunca
  // participa do PDV. Mesmo critério de unitBusinessService.
  // getPhysicalNumberedUnitBusinessIds (type PHYSICAL + número 1-24),
  // checado por instância em vez de na query — pega tanto ONLINE quanto a
  // loja placeholder "SEM_LOJA" (bling-order.service.ts, pedido cuja loja
  // não resolveu no Bling: number "0", fora do range, sem type PHYSICAL),
  // que senão ganhava PdvSalesRequest órfã e invisível em qualquer tela.
  private async isExcludedFromPdvFlow(unitBusinessId: string): Promise<boolean> {
    const [unitBusiness, cd21] = await Promise.all([
      unitBusinessService.findById(unitBusinessId),
      unitBusinessService.getCd21UnitBusiness(),
    ]);
    if (!unitBusiness) return false;
    if (cd21 && unitBusiness.id === cd21.id) return true;
    if (unitBusiness.type !== "PHYSICAL") return true;
    if (!isWithinPhysicalStoreRange(unitBusiness.number)) return true;
    return PDV_EXCLUDED_STORE_NUMBERS.includes(unitBusiness.number ?? "");
  }

  // ─── Quadro do Kanban (GET /sales-request) ───────────────────────────────
  // Colunas/status por tela vêm de helpers/pdv-screens.config.ts. Sem
  // `column`: quadro inteiro; com `column`: só a próxima página dela.
  async getBoard(
    access: PdvAccessContext,
    params: QueryParams,
    query: PdvBoardQuery,
  ): Promise<{ columns: PdvBoardColumnResult[] } | PdvBoardColumnResult> {
    const screen = resolveBoardScreen(access);
    const flags = {
      includeClosed: query.includeClosed,
      includeOtherScreens: query.includeOtherScreens,
    };

    if (query.column) {
      const column = findVisibleColumn(screen, query.column, flags);
      if (!column) {
        throw new PdvForbiddenError(
          `Coluna "${query.column}" não disponível para esta tela.`,
        );
      }
      const [result] = await this.getBoardColumns(access, params, query, [column]);
      return result;
    }

    return {
      columns: await this.getBoardColumns(
        access,
        params,
        query,
        resolveColumns(screen, flags),
      ),
    };
  }

  // 1 contagem agrupada + 1 página por coluna, tudo em paralelo (sem N+1).
  private async getBoardColumns(
    access: PdvAccessContext,
    params: QueryParams,
    query: PdvBoardQuery,
    columns: PdvBoardColumn[],
  ): Promise<PdvBoardColumnResult[]> {
    const screen = resolveBoardScreen(access);
    const baseWhere = await this.buildBoardBaseWhere(access, params);
    const cursorWhere = query.cursor ? boardCursorAfterLiteral(query.cursor) : null;

    const [statusCounts, ...pages] = await Promise.all([
      this.repository.countGroupedByStatus(baseWhere),
      ...columns.map((column) =>
        this.repository.findBoardColumnPage(
          {
            [Op.and]: [
              baseWhere,
              { status: { [Op.in]: column.statuses } },
              ...(cursorWhere ? [cursorWhere] : []),
            ],
          },
          query.limit,
        ),
      ),
    ]);

    return columns.map((column, index) => {
      const rows = pages[index].map(
        (record) => (record as any).get({ plain: true }) as any,
      );
      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);
      const lastRow = pageRows[pageRows.length - 1];

      return {
        key: column.key,
        label: column.label,
        description: column.description,
        statuses: column.statuses,
        extra: !!column.extra,
        highlighted: !column.extra && !!column.highlighted,
        items: pageRows.map((row) => toBoardCard(row, screen)),
        totalCount: column.statuses.reduce(
          (sum, status) => sum + (statusCounts[status] ?? 0),
          0,
        ),
        nextCursor:
          hasMore && lastRow
            ? encodeBoardCursor(lastRow.cursor_created_at, lastRow.id)
            : null,
        hasMore,
      };
    });
  }

  // Sempre [Op.and], nunca spread: indicator e search também usam [Op.and] e
  // se sobrescreveriam. Cada filtro é parseado sozinho pelo mesmo motivo —
  // QueryParser junta customFields com Object.assign.
  private async buildBoardBaseWhere(
    access: PdvAccessContext,
    params: QueryParams,
  ): Promise<WhereOptions> {
    // search fora do QueryParser: sem searchFields ele zeraria tudo (where.id = null).
    // filters[status] é ignorado — quem decide os status é a coluna.
    const { status: _ignoredStatus, ...filters } =
      typeof params.filters === "object" && params.filters ? params.filters : {};
    const term = params.search?.trim();

    const filterWheres = Object.entries(filters).map(
      ([field, value]) =>
        QueryParser.parse({ filters: { [field]: value } }, this.queryConfig).where,
    );
    const dateRangeWhere = QueryParser.parse(
      {
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        dateField: params.dateField,
      },
      this.queryConfig,
    ).where;

    const parts = [
      await this.unitBusinessScopeWhere(access.unitBusinessId),
      ...filterWheres,
      dateRangeWhere,
      ...(term ? [pdvSalesRequestSearchLiteral(term)] : []),
    ].filter((part) => Reflect.ownKeys(part).length > 0);

    return { [Op.and]: parts };
  }

  // Pedidos da loja sem solicitação PDV ativa — coluna "Em Aberto" do Kanban
  // (ver "Card do Kanban" em .claude/entities/pdv-sales-request/index.md).
  // unitBusinessId null (Televendas sem loja) traz de todas as lojas
  // físicas normais. Loja explicitamente fora do fluxo PDV (CD21 ou
  // PDV_EXCLUDED_STORE_NUMBERS) nunca tem pedido elegível — vazio, não erro
  // (mesmo espírito de "sem pedido elegível", não "acesso inválido").
  async findEligibleOrders(
    unitBusinessId: string | null,
  ): Promise<PdvSalesRequestOrderSummary[]> {
    if (unitBusinessId && (await this.isExcludedFromPdvFlow(unitBusinessId))) {
      return [];
    }

    const scope = await this.resolveUnitBusinessScope(unitBusinessId);
    const orders = await orderService.findEligibleForPdvByUnitBusiness(
      scope,
      ELIGIBLE_ORDERS_LIMIT,
    );
    if (!orders.length) return [];

    const activeRequests = await this.repository.findAll({
      where: {
        order_id: { [Op.in]: orders.map((order) => order.id) },
        status: { [Op.notIn]: TERMINAL_PDV_SALES_REQUEST_STATUSES },
      },
      attributes: ["order_id"],
    });
    const orderIdsWithActiveRequest = new Set(
      activeRequests.map((request) => request.order_id),
    );

    return orders
      .filter((order) => !orderIdsWithActiveRequest.has(order.id))
      .map((order) => this.toOrderSummary(order.get({ plain: true })))
      .filter((order): order is PdvSalesRequestOrderSummary => order !== null);
  }

  // order_id de toda solicitação existente, opcionalmente filtrada por
  // status — usado por rotas de outra entidade pra cruzar "tem/não tem PDV
  // request" (ex.: force-update em massa de orders), sem expor a repository.
  async findOrderIdsByStatus(
    statuses?: PdvSalesRequestStatus[],
  ): Promise<string[]> {
    return this.repository.findOrderIdsByStatus(statuses);
  }

  // ─── Resumo de status (indicativos) ──────────────────────────────────────
  // Igual em espírito a OrderService.getOrdersStatusSummary: um contador por
  // indicativo, escopado pela tela do acesso (cada tela só vê os
  // indicativos que fazem sentido pro fluxo dela — ver
  // helpers/status-summary.ts). Cada indicativo tem um filtro correspondente
  // na listagem (filters[indicator]=<key>), com o mesmo critério.
  async getStatusSummary(access: PdvAccessContext): Promise<
    Record<string, { label: string; quantity: number; sub_stats?: Record<string, number> }>
  > {
    const where = await this.unitBusinessScopeWhere(access.unitBusinessId);

    const keys = PDV_STATUS_INDICATORS_BY_SCREEN[access.screen];
    const needsTransporterCounts = keys.some(
      (key) => PDV_STATUS_INDICATORS[key].shippingType,
    );

    const [statusCounts, correctionOriginCounts, transporterCdCounts] =
      await Promise.all([
        this.repository.countGroupedByStatus(where),
        this.repository.countGroupedByCorrectionOrigin(where),
        needsTransporterCounts
          ? this.repository.countAdtShippingGroupedByTransporterCd(where)
          : Promise.resolve<Record<string, number>>({}),
      ]);

    const correctionOrigins = PDV_CORRECTION_ORIGINS_BY_SCREEN[access.screen];

    const summary: Record<
      string,
      { label: string; quantity: number; sub_stats?: Record<string, number> }
    > = {};

    for (const key of keys) {
      const definition = PDV_STATUS_INDICATORS[key];
      const sumCds = (cds: readonly string[]) =>
        cds.reduce((sum, cd) => sum + (transporterCdCounts[cd] ?? 0), 0);
      const statusTotal = definition.statuses.reduce(
        (sum, status) => sum + (statusCounts[status] ?? 0),
        0,
      );

      let quantity = statusTotal;
      if (definition.correctionOrigin) {
        quantity = correctionOriginCounts[definition.correctionOrigin] ?? 0;
      } else if (definition.shippingType) {
        quantity = definition.transporterCds
          ? sumCds(definition.transporterCds)
          : sumCds(Object.keys(transporterCdCounts));
      }

      summary[key] = { label: definition.label, quantity };

      if (key === "pending_correction" && correctionOrigins?.length) {
        summary[key].sub_stats = correctionOrigins.reduce<
          Record<string, number>
        >((acc, origin) => {
          acc[origin] = correctionOriginCounts[origin] ?? 0;
          return acc;
        }, {});
      }
    }

    return summary;
  }

  // Card expandido de um pedido de /orders/eligible, ainda sem
  // PdvSalesRequest — mesma forma que findByIdWithOrder, buscada por order_id.
  async findOrderDetail(
    orderId: string,
  ): Promise<PdvSalesRequestOrderDetail | null> {
    const order = await orderService.findByIdWithFullDetail(orderId);
    if (!order) return null;

    return this.toOrderDetail(order.get({ plain: true }));
  }

  // Chamado por bling-order.service.ts em toda criação/atualização de
  // pedido — cria a PdvSalesRequest vazia (status OPEN sempre) assim que o
  // pedido se torna elegível, pro front só precisar atrelar os dados depois
  // em vez de dar o passo extra de "Criar solicitação". Idempotente: se já
  // existe QUALQUER solicitação pro pedido, mesmo terminal
  // (FINISHED/CANCELLED/etc.), é no-op — nunca cria uma segunda pro mesmo
  // pedido por essa via automática (diferente de createRequest/POST manual,
  // que só bloqueia duplicidade de solicitação ainda ATIVA). Só assim pode
  // ser chamado em toda atualização, não só na criação do pedido, sem
  // re-lançar uma nova solicitação toda vez que o pedido volta a ficar
  // elegível depois de ter sido cancelado. Retorna a solicitação criada (null
  // se no-op). Mesmos 3 critérios de
  // findEligibleOrders/isEligibleForPdv: loja física normal (fora de
  // CD21/PDV_EXCLUDED_STORE_NUMBERS, nunca marketplace sem
  // unit_business_id), pedido não CANCELLED, sem romaneio já gerado pro
  // invoice/loja do pedido. No-op silencioso pra qualquer pedido não
  // elegível ou que já tenha solicitação (de qualquer status).
  async createEmptyRequestForNewOrderIfEligible(
    orderId: string,
  ): Promise<PdvSalesRequest | null> {
    const order = await orderService.findById(orderId);
    if (!order?.unit_business_id) return null;
    if (await this.isExcludedFromPdvFlow(order.unit_business_id)) return null;
    if (!(await orderService.isEligibleForPdv(orderId))) return null;
    if (await this.repository.findByOrderId(orderId)) return null;

    return this.createRequest({ orderId });
  }

  // ─── Máquina de estados ─────────────────────────────────────────────────────
  // Ponto único de escrita de status: toda transição passa por aqui e grava a
  // linha de histórico correspondente na mesma transação — nunca escreve
  // `status` fora deste método (mesmo espírito de
  // order/helpers/order-status.ts::syncOrderInternalStatus).

  private async transitionTo(
    id: string,
    target: PdvSalesRequestStatus,
    params: { userId?: string; description: string },
  ): Promise<PdvSalesRequest> {
    const updated = await sequelize.transaction(async (t) => {
      const updated = await this.repository.update(
        id,
        { status: target },
        { transaction: t },
      );
      if (!updated) throw new Error("Solicitação não encontrada");

      await pdvSalesRequestHistoryService.create(
        {
          pdv_sales_request_id: id,
          step: target,
          description: params.description,
          date: new Date(),
          user_id: params.userId ?? null,
        },
        { transaction: t },
      );

      return updated;
    });

    notifySalesRequestChanged(updated);

    return updated;
  }

  private async assertStatus(
    id: string,
    expected: PdvSalesRequestStatus | PdvSalesRequestStatus[],
  ): Promise<PdvSalesRequest> {
    const request = await this.repository.findById(id);
    if (!request) throw new Error("Solicitação não encontrada");
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(request.status)) {
      throw new Error(
        `Ação inválida: a solicitação está em ${request.status}, era esperado ${allowed.join(" ou ")}`,
      );
    }
    return request;
  }

  private async resolveBranchId(
    unitBusinessId: string | null,
  ): Promise<number | undefined> {
    if (!unitBusinessId) return undefined;

    const unitBusiness = await unitBusinessService.findById(unitBusinessId);
    return unitBusiness?.number ? Number(unitBusiness.number) : undefined;
  }

  // Nota de transferência é emitida pela filial de origem, não pela loja que
  // abriu a solicitação PDV (que só recebe a mercadoria) — as duas podem ser
  // unit_business diferentes, então a filial Tecinco tem que vir do CNPJ do
  // emitente lido no próprio documento, nunca do unit_business da solicitação.
  private async resolveBranchIdByCnpj(
    cnpj: string,
  ): Promise<number | undefined> {
    const unitBusiness = await unitBusinessService.findOne({
      where: { cnpj: cleanDocument(cnpj) },
    });
    return unitBusiness?.number ? Number(unitBusiness.number) : undefined;
  }

  // Registra uma ação que NÃO muda `status` (edição de comprovante/nota de
  // transferência antes de confirmar) — todo o resto do histórico passa por
  // transitionTo, mas "cada ação na solicitação" (spec original do módulo)
  // inclui edições que ainda não avançaram etapa. `step` repete o status
  // atual, já que ele não mudou.
  private async logAction(
    request: PdvSalesRequest,
    params: { userId?: string; description: string },
  ): Promise<void> {
    await pdvSalesRequestHistoryService.create({
      pdv_sales_request_id: request.id,
      step: request.status,
      description: params.description,
      date: new Date(),
      user_id: params.userId ?? null,
    });

    notifySalesRequestChanged(request);
  }

  // Condicional no banco (origin IS NULL) — só a 1ª ação grava, mesmo com chamadas concorrentes.
  private async recordOriginIfUnset(
    id: string,
    origin: PdvSalesRequestOrigin | null | undefined,
  ): Promise<void> {
    if (!origin) return;
    await this.repository.bulkUpdate({ origin }, { where: { id, origin: null } });
  }

  // ─── Criação ────────────────────────────────────────────────────────────────

  async createRequest(params: {
    orderId: string;
    // Sem name ainda (ex.: auto-criação vazia — ver bling-order.service.ts e
    // setShippingType) — usa um rótulo derivado do próprio pedido; front
    // "atrela os dados" depois, name nunca fica preso sem valor (coluna
    // NOT NULL).
    name?: string;
    createdByUserId?: string;
    unitBusinessId?: string | null;
  }): Promise<PdvSalesRequest> {
    const existingActive = await this.repository.findActiveByOrderId(
      params.orderId,
    );
    if (existingActive) {
      throw new Error("Já existe uma solicitação ativa para este pedido");
    }

    const order = await orderService.findById(params.orderId);
    if (!order) {
      throw new Error("Pedido não encontrado");
    }
    if (
      params.unitBusinessId &&
      order.unit_business_id !== params.unitBusinessId
    ) {
      throw new Error("Pedido não pertence à loja deste acesso");
    }

    // Acesso global (Televendas/Financeiro, unitBusinessId null) não passa
    // pela checagem de ownership acima — sem isso, um orderId arbitrário no
    // body criaria solicitação pra pedido de CD21/ONLINE/SEM_LOJA ou já
    // com romaneio gerado. Mesmo critério de createEmptyRequestForNewOrderIfEligible.
    if (
      !order.unit_business_id ||
      (await this.isExcludedFromPdvFlow(order.unit_business_id)) ||
      !(await orderService.isEligibleForPdv(params.orderId))
    ) {
      throw new Error("Pedido não é elegível para o fluxo PDV");
    }

    const created = await sequelize.transaction(async (t) => {
      const created = await this.repository.create(
        {
          order_id: params.orderId,
          // Espelhado de order.unit_business_id — nunca setado via API.
          unit_business_id: order.unit_business_id ?? null,
          // Espelhado de order.invoice_id — nunca setado via API.
          sale_invoice_id: order.invoice_id ?? null,
          transfer_invoice_id: null,
          status: PdvSalesRequestStatus.OPEN,
          correction_origin_status: null,
          shipping_type: null,
          shipping_address: null,
          transporter_name: null,
          origin: null,
          transfer_invoice_products_match_sale: null,
          name: params.name ?? `Pedido ${order.number_order_channel}`,
          errors: null,
          created_by_user_id: params.createdByUserId ?? null,
        },
        { transaction: t },
      );

      await pdvSalesRequestHistoryService.create(
        {
          pdv_sales_request_id: created.id,
          step: PdvSalesRequestStatus.OPEN,
          description: "Solicitação criada",
          date: new Date(),
          user_id: params.createdByUserId ?? null,
        },
        { transaction: t },
      );

      return created;
    });

    notifySalesRequestChanged(created);

    return created;
  }

  // ─── Loja: comprovantes + tipo de envio ─────────────────────────────────────
  // Pode haver mais de um comprovante por solicitação (ex.: 50% PIX + 50%
  // cartão) — cada anexo cria uma linha em PdvSalesRequestReceipt, nunca
  // substitui as demais. payment_receipt_analysis/validated/
  // payment_method_matches_receipt em PdvSalesRequest deixam de ser "a
  // análise do único comprovante" e passam a ser a CONCILIAÇÃO de todos os
  // comprovantes anexados no momento (reconcileReceipts), recalculada toda
  // vez que um comprovante é adicionado/editado/removido.

  // Limpa o timer assim que qualquer lado resolve — sem isso, o setTimeout
  // fica pendurado até disparar mesmo quando a análise já terminou rápido.
  private withReceiptAnalysisTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Análise excedeu ${RECEIPT_ANALYSIS_TIMEOUT_MS}ms`)),
        RECEIPT_ANALYSIS_TIMEOUT_MS,
      );
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Roda a extração local (pdf-parse/OCR, ver payment-receipt-extraction.service.ts)
  // de UM comprovante — nunca bloqueia o anexo por falha/demora da extração
  // (documento ilegível, OCR malformado, ou análise passando de
  // RECEIPT_ANALYSIS_TIMEOUT_MS): financeiro revisa manualmente, análise
  // segue null. Devolve a extração crua — quem chama decide se persiste
  // (runReceiptAnalysisAsync checa duplicidade antes).
  private async analyzeReceiptFile(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{
    analysis: PaymentReceiptExtraction | null;
    validated: boolean | null;
    fingerprint: string | null;
  }> {
    try {
      const result = await this.withReceiptAnalysisTimeout(
        paymentReceiptExtractionService.analyze(buffer, mimeType),
      );
      return {
        analysis: result.extraction,
        validated: result.validated,
        fingerprint: result.fingerprint,
      };
    } catch (err) {
      console.warn(
        "[PDV] Falha ao analisar comprovante — seguindo sem análise",
        err,
      );
      return { analysis: null, validated: null, fingerprint: null };
    }
  }

  // Duplicidade é global (mesmo comprovante em QUALQUER solicitação, não só
  // nesta) — única falha tratada como erro de verdade dentro do fluxo de
  // análise (ver .claude/modules/ai-vision-extraction.md). excludeReceiptId
  // evita que editar a análise de uma linha a autobloqueie contra ela mesma.
  private async assertReceiptNotDuplicate(
    fingerprint: string | null,
    excludeReceiptId?: string,
  ): Promise<void> {
    if (!fingerprint) return;

    const duplicate = await pdvSalesRequestReceiptService.findByFingerprint(
      fingerprint,
      excludeReceiptId,
    );
    if (duplicate) {
      throw new DuplicateReceiptError(
        "Este comprovante já foi utilizado em outra solicitação",
      );
    }
  }

  // Recalcula e persiste payment_receipt_analysis/validated/
  // payment_method_matches_receipt a partir de TODOS os comprovantes
  // atualmente anexados — chamado depois de qualquer mutação numa linha de
  // comprovante (criar, editar análise, apagar). payment_method_matches_receipt
  // compara o conjunto de formas de pagamento da Bling com o de comprovantes.
  private async reconcileReceipts(
    requestId: string,
    orderId: string,
  ): Promise<PdvSalesRequest> {
    const receipts =
      await pdvSalesRequestReceiptService.findAllByRequestId(requestId);
    const analyses = receipts
      .map((r) => r.analysis)
      .filter((a): a is PaymentReceiptExtraction => a !== null);

    const analysis = reconcileReceiptAnalyses(analyses);
    const validated = reconcileReceiptValidation(
      receipts.map((r) => r.validated),
    );

    // Busca a order uma vez só — usada pro match de formas de pagamento e
    // pro match de valor total.
    const order = await orderService.findByIdWithPayments(orderId);

    const orderPaymentMethods = ((order as any)?.payments ?? []).map(
      (payment: any) => ({
        id: payment.paymentMethod?.id ?? null,
        description: payment.paymentMethod?.description ?? null,
      }),
    );
    const matchesReceipt = paymentMethodsMatchReceipts(
      orderPaymentMethods,
      receipts.map((r) => ({
        type: r.analysis?.tipo_comprovante ?? null,
        paymentMethodId: r.analysis?.payment_method?.id ?? null,
      })),
    );

    const receiptTotal = analysis?.valor_total ?? null;
    const orderTotal = (order as any)?.net_total_order ?? null;

    const updated = await this.repository.update(requestId, {
      payment_receipt_analysis: analysis,
      payment_receipt_validated: validated,
      payment_method_matches_receipt: matchesReceipt,
      receipt_total_matches_order: receiptTotalMatchesOrder(
        receiptTotal,
        orderTotal,
      ),
      receipt_total_difference: receiptTotalDifference(receiptTotal, orderTotal),
    });
    if (!updated) throw new Error("Solicitação não encontrada");

    return updated;
  }

  // Janela de status em que cada tela pode editar comprovante/tipo de envio —
  // a loja ainda está montando a solicitação (OPEN/PENDING_CORRECTION);
  // Financeiro complementa/corrige durante a própria análise
  // (PENDING_FINANCE); CD21 corrige a análise depois, já em faturamento
  // (PENDING_CD21_ANALYSIS/PENDING_NF_SALE). Upload/delete de comprovante
  // fica de fora pra CD21 mesmo dentro dessa janela — não por checagem
  // aqui, e sim porque as rotas de upload/delete nunca incluem CD21 no
  // pdvAccess([...]) (pdv-sales-request.controller.ts).
  private static readonly RECEIPT_EDITABLE_STATUSES_BY_SCREEN: Record<
    PdvAccessScreen,
    PdvSalesRequestStatus[]
  > = {
    [PdvAccessScreen.STORE_REQUEST]: [
      PdvSalesRequestStatus.OPEN,
      PdvSalesRequestStatus.PENDING_CORRECTION,
    ],
    [PdvAccessScreen.FINANCE]: [PdvSalesRequestStatus.PENDING_FINANCE],
    [PdvAccessScreen.CD21]: [
      PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
      PdvSalesRequestStatus.PENDING_NF_SALE,
    ],
  };

  // Também serve pra resolver uma correção vinda do financeiro (comprovante
  // rejeitado): a loja não "decide" nada num endpoint de correção genérico,
  // ela resolve anexando um comprovante novo — mas só depois de confirmar
  // (confirmReceiptSubmission), não automaticamente aqui.
  private async assertReceiptEditable(
    id: string,
    screen: PdvAccessScreen = PdvAccessScreen.STORE_REQUEST,
    { anyCorrectionOrigin = false }: { anyCorrectionOrigin?: boolean } = {},
  ): Promise<PdvSalesRequest> {
    const request = await this.assertStatus(
      id,
      PdvSalesRequestService.RECEIPT_EDITABLE_STATUSES_BY_SCREEN[screen],
    );

    if (
      !anyCorrectionOrigin &&
      screen === PdvAccessScreen.STORE_REQUEST &&
      request.status === PdvSalesRequestStatus.PENDING_CORRECTION &&
      request.correction_origin_status !== PdvSalesRequestStatus.PENDING_FINANCE
    ) {
      throw new Error(
        "Correção pendente não é de comprovante — resolva pelo endpoint de correção",
      );
    }

    return request;
  }

  // Separado do anexo de comprovante desde que a solicitação passou a aceitar
  // N comprovantes — shipping_type é propriedade da PRÓPRIA solicitação, não
  // de um comprovante específico. Não avança status sozinho.
  async setShippingType(
    id: string,
    shippingType: PdvShippingType,
    screen: PdvAccessScreen = PdvAccessScreen.STORE_REQUEST,
    userId?: string,
    origin?: PdvSalesRequestOrigin | null,
  ): Promise<PdvSalesRequest> {
    this.assertValidShippingType(shippingType);
    // Editar info (não anexar/remover comprovante) vale em qualquer PENDING_CORRECTION, ex.: CD21 devolveu por SHIPPING_TYPE
    const request = await this.assertReceiptEditable(id, screen, {
      anyCorrectionOrigin: true,
    });
    await this.assertShippingTypeAllowedForTransporter(
      request.sale_invoice_id,
      shippingType,
    );

    await this.recordOriginIfUnset(id, origin);
    const updated = await this.repository.update(id, {
      shipping_type: shippingType,
    });
    if (!updated) throw new Error("Solicitação não encontrada");

    await this.logAction(request, {
      userId,
      description: "Tipo de envio definido",
    });

    return updated;
  }

  private assertValidShippingType(shippingType: PdvShippingType): void {
    if (!Object.values(PdvShippingType).includes(shippingType)) {
      throw new Error("Tipo de envio inválido");
    }
  }

  // Parcial: só os campos enviados mudam; "" limpa (vira null). Mesma janela de edição do tipo de envio.
  async setShippingInfo(
    id: string,
    info: { shippingAddress?: string | null; transporterName?: string | null },
    screen: PdvAccessScreen = PdvAccessScreen.STORE_REQUEST,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id, screen, {
      anyCorrectionOrigin: true,
    });

    const normalize = (value: string | null) =>
      value == null ? null : String(value).trim() || null;
    const changes = {
      ...(info.shippingAddress !== undefined && {
        shipping_address: normalize(info.shippingAddress),
      }),
      ...(info.transporterName !== undefined && {
        transporter_name: normalize(info.transporterName),
      }),
    };
    if (!Object.keys(changes).length) {
      throw new Error("Informe o endereço de envio e/ou a transportadora");
    }

    const updated = await this.repository.update(id, changes);
    if (!updated) throw new Error("Solicitação não encontrada");

    await this.logAction(request, {
      userId,
      description: "Endereço de envio/transportadora atualizados",
    });

    return updated;
  }

  // Só cobra quando a nota de venda do pedido (order.invoice_id, fonte de verdade) não informa transportadora.
  private async assertShippingInfoFilledIfRequired(
    request: PdvSalesRequest,
  ): Promise<void> {
    if (request.shipping_address?.trim() && request.transporter_name?.trim()) {
      return;
    }

    const order = await orderService.findById(request.order_id, {
      attributes: ["id", "invoice_id"],
    });
    if (!(await this.isShippingInfoRequired(order?.invoice_id ?? null))) {
      return;
    }

    throw new Error(
      "Preencha o endereço de envio e a transportadora antes de enviar a solicitação",
    );
  }

  // Endereço/transportadora só são opcionais com nota de venda cuja
  // transportadora não é "Sem transporte" — também vira shipping_info_required no detalhe.
  private async isShippingInfoRequired(
    saleInvoiceId: string | null,
  ): Promise<boolean> {
    if (!saleInvoiceId) return true;
    const saleInvoice = await invoiceService.findById(saleInvoiceId, {
      attributes: ["id", "transporter_name"],
    });
    return transporterService.isNoTransporterName(saleInvoice?.transporter_name);
  }

  // ADT ⇔ transportadora CD 12/17. Sem nota de venda ou sem transportadora na nota não dá pra checar — libera.
  private async assertShippingTypeAllowedForTransporter(
    saleInvoiceId: string | null,
    shippingType: PdvShippingType,
  ): Promise<void> {
    if (!saleInvoiceId) return;

    const saleInvoice = await invoiceService.findById(saleInvoiceId, {
      attributes: ["id", "transporter_name"],
    });
    const transporterName = saleInvoice?.transporter_name;
    if (transporterService.isNoTransporterName(transporterName)) return;

    const cd = extractTransporterCd(transporterName);
    const isAdtTransporter = !!cd && ADT_TRANSPORTER_CDS.includes(cd);

    if (shippingType === PdvShippingType.TRANSPORTADORA && isAdtTransporter) {
      throw new Error(
        `A transportadora deste pedido é o CD ${cd}, então o tipo de envio só pode ser ADT.`,
      );
    }
    if (shippingType === PdvShippingType.ADT && !isAdtTransporter) {
      throw new Error(
        `ADT só é permitido para pedidos com transportadora ${ADT_TRANSPORTER_CDS.map((adtCd) => `CD ${adtCd}`).join(" ou ")}. A transportadora deste pedido é ${transporterName}, então o tipo de envio só pode ser TRANSPORTADORA.`,
      );
    }
  }

  private static readonly SHIPPING_TYPE_CHANGEABLE_STATUSES: PdvSalesRequestStatus[] =
    [
      PdvSalesRequestStatus.PENDING_NF_SALE,
      PdvSalesRequestStatus.PENDING_NF_TRANSFER,
      ...EXPEDITION_PDV_SALES_REQUEST_STATUSES,
    ];

  // Troca de tipo de envio já em faturamento/expedição (CD21) — diferente de
  // setShippingType, realinha o status ao tipo novo.
  async changeShippingType(
    id: string,
    shippingType: PdvShippingType,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    this.assertValidShippingType(shippingType);
    const request = await this.assertStatus(
      id,
      PdvSalesRequestService.SHIPPING_TYPE_CHANGEABLE_STATUSES,
    );
    await this.assertShippingTypeAllowedForTransporter(
      request.sale_invoice_id,
      shippingType,
    );

    if (request.shipping_type === shippingType) return request;

    // Nota de transferência só existe em ADT — saindo dele, desvincula.
    const updated = await this.repository.update(id, {
      shipping_type: shippingType,
      ...(shippingType === PdvShippingType.TRANSPORTADORA && {
        transfer_invoice_id: null,
      }),
    });
    if (!updated) throw new Error("Solicitação não encontrada");

    const description = `Tipo de envio alterado de ${request.shipping_type ?? "não definido"} para ${shippingType}`;
    const target = await this.resolveStatusAfterShippingTypeChange(
      request,
      shippingType,
    );

    if (target === request.status) {
      await this.logAction(request, { userId, description });
      return updated;
    }

    return this.transitionTo(id, target, { userId, description });
  }

  private async resolveStatusAfterShippingTypeChange(
    request: PdvSalesRequest,
    shippingType: PdvShippingType,
  ): Promise<PdvSalesRequestStatus> {
    // Sem nota de venda ainda: markSaleInvoiceReady já roteia pelo tipo novo.
    if (request.status === PdvSalesRequestStatus.PENDING_NF_SALE) {
      return request.status;
    }
    // ADT sem nota de transferência volta pra fila de vínculo dela.
    if (shippingType === PdvShippingType.ADT) {
      return request.transfer_invoice_id
        ? PdvSalesRequestStatus.SHIPPING
        : PdvSalesRequestStatus.PENDING_NF_TRANSFER;
    }
    return (await this.isSaleInvoiceDeliveryNoteGenerated(request.sale_invoice_id))
      ? PdvSalesRequestStatus.FINISHED
      : PdvSalesRequestStatus.SHIP_TODAY;
  }

  // Adiciona UM comprovante — nunca substitui os já anexados (pode haver mais
  // de um, ex.: 50% PIX + 50% cartão; pra trocar um errado, DELETE
  // /:id/receipt/:receiptId e anexe outro). Análise roda em background (ver
  // runReceiptAnalysisAsync) e, ao terminar, reconcilia com os demais
  // comprovantes já anexados.
  async attachReceipt(
    id: string,
    params: {
      buffer: Buffer;
      filename: string;
      mimeType: string;
      screen?: PdvAccessScreen;
      userId?: string;
      origin?: PdvSalesRequestOrigin | null;
    },
  ): Promise<PdvSalesRequestReceipt> {
    const request = await this.assertReceiptEditable(id, params.screen);

    // Resposta instantânea: staging + linha com path sentinela na mesma
    // transação; upload real roda em background (ver .claude/modules/uploader-queue.md).
    const receiptId = randomUUID();
    let tempFileId!: string;
    let receipt!: PdvSalesRequestReceipt;

    await sequelize.transaction(async (t) => {
      const tempFile = await tempFileService.create(
        {
          buffer: params.buffer,
          mime_type: params.mimeType,
          original_filename: params.filename,
          upload_directory: `/pdv-receipts/${id}`,
          preserve_filename: false,
          entity_type: "PDV_SALES_REQUEST_RECEIPT",
          entity_id: receiptId,
        },
        { transaction: t },
      );
      tempFileId = tempFile.id;

      const payload = {
        id: receiptId,
        pdv_sales_request_id: id,
        path: buildTempFileSentinelPath(tempFile.id),
        analysis: null,
        validated: null,
        fingerprint: null,
        created_by_user_id: params.userId ?? null,
      };
      receipt = await pdvSalesRequestReceiptService.create(payload, {
        transaction: t,
      });
    });

    await uploaderQueue.enqueueUpload(tempFileId, "PDV_SALES_REQUEST_RECEIPT");
    await this.recordOriginIfUnset(id, params.origin);

    await this.logAction(request, {
      userId: params.userId,
      description: "Comprovante adicionado",
    });

    // .catch aqui é só rede de segurança pra erro inesperado não virar
    // unhandledRejection — o job já trata AI/duplicidade internamente.
    this.runReceiptAnalysisAsync(
      id,
      request.order_id,
      receipt.id,
      params.buffer,
      params.mimeType,
    ).catch((err) =>
      console.error(
        "[PDV] Falha inesperada na análise assíncrona do comprovante",
        err,
      ),
    );

    return receipt;
  }

  // Remove um comprovante antes de confirmar — apaga o arquivo do uploader
  // (best-effort, mesmo padrão de deleteRequest) e reconcilia os que
  // sobraram.
  async deleteReceipt(
    id: string,
    receiptId: string,
    screen: PdvAccessScreen = PdvAccessScreen.STORE_REQUEST,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id, screen);
    const receipt = await pdvSalesRequestReceiptService.findById(receiptId);
    if (!receipt || receipt.pdv_sales_request_id !== id) {
      throw new Error("Comprovante não encontrado nesta solicitação");
    }

    await pdvSalesRequestReceiptService.delete(receiptId);

    await uploaderQueue
      .enqueueDelete(
        resolveDeleteTarget(receipt.path),
        "PDV_SALES_REQUEST_RECEIPT",
        buildEntityCacheKey("PDV_SALES_REQUEST_RECEIPT", receiptId),
      )
      .catch((err) =>
        console.warn("[PDV] Falha ao enfileirar limpeza do comprovante", err),
      );

    const updated = await this.reconcileReceipts(id, request.order_id);

    await this.logAction(request, {
      userId,
      description: "Comprovante removido",
    });

    return updated;
  }

  // Liga o tipo extraído da imagem a uma forma já cadastrada em
  // payment_methods (preferindo as do próprio pedido) — null se ambíguo ou
  // inexistente, aí o match segue por palavra-chave.
  private async resolveReceiptPaymentMethod(
    orderId: string,
    receiptType: PaymentReceiptExtraction["tipo_comprovante"],
  ): Promise<PaymentReceiptPaymentMethod | null> {
    if (!receiptType) return null;

    const [order, catalog] = await Promise.all([
      orderService.findByIdWithPayments(orderId),
      paymentMethodService.findLightCatalog(),
    ]);

    const orderMethods = new Map<string, PaymentReceiptPaymentMethod>();
    for (const payment of (order as any)?.payments ?? []) {
      const method = payment.paymentMethod;
      if (method) {
        orderMethods.set(method.id, {
          id: method.id,
          description: method.description,
        });
      }
    }

    return resolvePaymentMethodForReceipt(
      receiptType,
      [...orderMethods.values()],
      catalog.map((m) => ({ id: m.id, description: m.description })),
    );
  }

  private async loadPaymentMethodsOrFail(
    ids: string[],
  ): Promise<PaymentReceiptPaymentMethod[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];

    const found = await paymentMethodService.findLightByIds(unique);
    if (found.length !== unique.length) {
      throw new Error("Forma de pagamento não encontrada");
    }
    return found.map((m) => ({ id: m.id, description: m.description }));
  }

  // Roda em background, depois do attach já ter respondido. Reconfere que a
  // linha do comprovante ainda existe antes de gravar — se a loja apagou
  // esse comprovante enquanto a análise rodava, descarta.
  private async runReceiptAnalysisAsync(
    requestId: string,
    orderId: string,
    receiptId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    try {
      const result = await this.analyzeReceiptFile(buffer, mimeType);

      const current = await pdvSalesRequestReceiptService.findById(receiptId);
      if (!current) return;

      // Verifica duplicidade ANTES de persistir — em caso de duplicidade,
      // a linha do comprovante fica com analysis/validated/fingerprint null
      // (comprovante segue anexado, usuário troca), mesmo espírito de antes.
      await this.assertReceiptNotDuplicate(result.fingerprint, receiptId);

      const analysis = result.analysis
        ? {
            ...result.analysis,
            payment_method: await this.resolveReceiptPaymentMethod(
              orderId,
              result.analysis.tipo_comprovante,
            ),
          }
        : null;

      await pdvSalesRequestReceiptService.update(receiptId, {
        analysis,
        validated: result.validated,
        fingerprint: result.fingerprint,
      });

      const reconciled = await this.reconcileReceipts(requestId, orderId);
      notifySalesRequestChanged(reconciled);

      socketService.emitToNamespaceRoom(
        PDV_SOCKET_NAMESPACE,
        pdvSalesRequestRoom(requestId),
        PAYMENT_RECEIPT_ANALYSIS_DONE_EVENT,
        {
          requestId,
          receiptId,
          success: true,
          analysis: pickReceiptAnalysisFields(analysis),
          validated: result.validated,
          reconciled: {
            analysis: pickReceiptAnalysisFields(
              reconciled.payment_receipt_analysis,
            ),
            validated: reconciled.payment_receipt_validated,
            paymentMethodMatchesReceipt:
              reconciled.payment_method_matches_receipt,
            totalMatchesOrder: reconciled.receipt_total_matches_order,
            totalDifference: reconciled.receipt_total_difference,
          },
        },
      );
    } catch (err: any) {
      console.warn(
        "[PDV] Falha ao processar análise assíncrona do comprovante — comprovante segue anexado sem análise",
        err,
      );

      const isDuplicate = err instanceof DuplicateReceiptError;
      socketService.emitToNamespaceRoom(
        PDV_SOCKET_NAMESPACE,
        pdvSalesRequestRoom(requestId),
        PAYMENT_RECEIPT_ANALYSIS_DONE_EVENT,
        {
          requestId,
          receiptId,
          success: false,
          reason: isDuplicate ? "DUPLICATE_RECEIPT" : "ANALYSIS_UNAVAILABLE",
          message: isDuplicate
            ? err.message
            : "Extração automática indisponível — revise o comprovante manualmente antes de enviar.",
        },
      );
    }
  }

  // Confirmação explícita do front — só agora a solicitação avança pra
  // PENDING_FINANCE. Exige ao menos 1 comprovante anexado (attachReceipt) e
  // o tipo de envio definido (setShippingType).
  async confirmReceiptSubmission(
    id: string,
    screen: PdvAccessScreen = PdvAccessScreen.STORE_REQUEST,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id, screen);
    const receipts =
      await pdvSalesRequestReceiptService.findAllByRequestId(id);

    if (!receipts.length || !request.shipping_type) {
      throw new Error(
        "Anexe ao menos um comprovante e o tipo de envio antes de confirmar",
      );
    }
    await this.assertShippingInfoFilledIfRequired(request);

    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_FINANCE, {
      userId,
      description:
        request.status === PdvSalesRequestStatus.PENDING_CORRECTION
          ? "Novo comprovante confirmado — correção resolvida, aguardando financeiro"
          : "Comprovante e tipo de envio confirmados — aguardando análise do financeiro",
    });
  }

  // Loja corrige manualmente um ou mais campos da análise de UM comprovante
  // (a IA pode errar, ex.: comprovante de maquininha mostra o apelido da
  // máquina em vez do nome do banco) antes de confirmar pro financeiro —
  // mesma janela de edição do comprovante em si (assertReceiptEditable),
  // nunca depois de confirmado. `updates` é parcial: só os campos enviados
  // são sobrescritos, o resto da análise atual é preservada. Revalida/
  // recalcula validated/fingerprint (com a mesma checagem de duplicidade)
  // desta linha e reconcilia a solicitação inteira em seguida.
  async updateReceiptAnalysis(
    id: string,
    receiptId: string,
    updates: unknown,
    screen: PdvAccessScreen = PdvAccessScreen.STORE_REQUEST,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id, screen, {
      anyCorrectionOrigin: true,
    });
    const receipt = await pdvSalesRequestReceiptService.findById(receiptId);
    if (!receipt || receipt.pdv_sales_request_id !== id) {
      throw new Error("Comprovante não encontrado nesta solicitação");
    }

    const { payment_method_id, ...parsedUpdates } =
      PaymentReceiptEditSchema.parse(updates);
    const merged: PaymentReceiptExtraction = {
      ...(receipt.analysis ?? EMPTY_PAYMENT_RECEIPT_EXTRACTION),
      ...parsedUpdates,
    };

    // Forma escolhida no catálogo manda: tipo_comprovante é derivado dela em
    // vez do enviado no mesmo body — null se a forma não tem tipo no enum
    // (Dinheiro, Cheque, Boleto, Outros), pra nunca contradizer a forma.
    if (payment_method_id !== undefined) {
      if (payment_method_id === null) {
        merged.payment_method = null;
      } else {
        const [method] = await this.loadPaymentMethodsOrFail([
          payment_method_id,
        ]);
        merged.payment_method = method;
        merged.tipo_comprovante = receiptTypeFromPaymentMethod(
          method.description,
        );
      }
    } else if (
      parsedUpdates.tipo_comprovante !== undefined &&
      parsedUpdates.tipo_comprovante !== receipt.analysis?.tipo_comprovante
    ) {
      // Só o tipo mudou: a forma antiga ficaria salva e, como o match prioriza
      // o id, ignoraria o tipo editado — re-resolve como no upload.
      merged.payment_method = await this.resolveReceiptPaymentMethod(
        request.order_id,
        merged.tipo_comprovante,
      );
    }

    const { validated, fingerprint } =
      paymentReceiptExtractionService.computeDerived(merged);
    await this.assertReceiptNotDuplicate(fingerprint, receiptId);

    await pdvSalesRequestReceiptService.update(receiptId, {
      analysis: merged,
      validated,
      fingerprint,
    });

    const updated = await this.reconcileReceipts(id, request.order_id);

    await this.logAction(request, {
      userId,
      description: "Análise do comprovante editada manualmente",
    });

    return updated;
  }

  // Sobrescreve o resumo conciliado (payment_receipt_analysis) direto na
  // solicitação — nunca mexe em nenhum PdvSalesRequestReceipt individual.
  // Simples, sem lock: se depois um comprovante for adicionado, editado ou
  // removido, reconcileReceipts roda de novo e sobrescreve este valor
  // manual (mesmo espírito de hoje — a conciliação automática é sempre a
  // fonte, isso aqui é só um ajuste pontual). Mesma janela de edição que
  // updateReceiptAnalysis; não toca payment_receipt_validated/
  // payment_method_matches_receipt (esses dois são sobre CADA comprovante,
  // não sobre o resumo). receipt_total_matches_order/difference SÃO recalculados — é
  // literalmente a comparação do campo que este endpoint acabou de mudar
  // (valor_total) contra order.net_total_order, deixaria o aviso desatualizado
  // se não recalculasse.
  async updatePaymentReceiptAnalysis(
    id: string,
    updates: unknown,
    screen: PdvAccessScreen = PdvAccessScreen.STORE_REQUEST,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id, screen, {
      anyCorrectionOrigin: true,
    });

    const { payment_method_ids, ...parsedUpdates } =
      PaymentReceiptReconciledEditSchema.parse(updates);
    const merged: PaymentReceiptReconciledAnalysis = {
      ...(request.payment_receipt_analysis ?? EMPTY_PAYMENT_RECEIPT_EXTRACTION),
      ...parsedUpdates,
    };

    if (payment_method_ids !== undefined) {
      const methods = await this.loadPaymentMethodsOrFail(payment_method_ids);
      merged.payment_methods = methods;

      const types = [
        ...new Set(
          methods
            .map((m) => receiptTypeFromPaymentMethod(m.description))
            .filter((type): type is NonNullable<typeof type> => type !== null),
        ),
      ];
      merged.tipo_comprovante = types.length ? types.join(" + ") : null;
    }

    const order = await orderService.findById(request.order_id);
    const orderTotal = (order as any)?.net_total_order ?? null;

    const updated = await this.repository.update(id, {
      payment_receipt_analysis: merged,
      receipt_total_matches_order: receiptTotalMatchesOrder(
        merged.valor_total,
        orderTotal,
      ),
      receipt_total_difference: receiptTotalDifference(
        merged.valor_total,
        orderTotal,
      ),
    });
    if (!updated) throw new Error("Solicitação não encontrada");

    await this.logAction(request, {
      userId,
      description: "Resumo do pagamento editado manualmente",
    });

    return updated;
  }

  // Buffer do arquivo de UM comprovante — mesmo padrão de
  // getInvoiceDanfeBuffer: confere que o comprovante pertence a esta
  // solicitação antes de servir.
  async getReceiptBuffer(
    id: string,
    receiptId: string,
  ): Promise<{ buffer: Buffer; extension: string }> {
    const receipt = await pdvSalesRequestReceiptService.findById(receiptId);
    if (!receipt || receipt.pdv_sales_request_id !== id) {
      throw new Error("Comprovante não encontrado nesta solicitação");
    }

    if (isTempFileSentinelPath(receipt.path)) {
      const tempFile = await tempFileService.findById(
        extractTempFileId(receipt.path),
        { attributes: ["id", "buffer", "mime_type"] },
      );
      if (tempFile) {
        return {
          buffer: tempFile.buffer,
          extension: tempFile.mime_type.split("/").pop() || "jpeg",
        };
      }

      // corrida: o job de upload já terminou entre a leitura acima e agora —
      // recarrega o path real já atualizado.
      const refreshed = await pdvSalesRequestReceiptService.findById(receiptId);
      if (!refreshed || isTempFileSentinelPath(refreshed.path)) {
        throw new Error("Comprovante ainda não disponível, tente novamente");
      }
      const buffer = await uploaderService.getFile(
        refreshed.path,
        buildEntityCacheKey("PDV_SALES_REQUEST_RECEIPT", receiptId),
      );
      return { buffer, extension: refreshed.path.split(".").pop() || "jpeg" };
    }

    const buffer = await uploaderService.getFile(
      receipt.path,
      buildEntityCacheKey("PDV_SALES_REQUEST_RECEIPT", receiptId),
    );
    const extension = receipt.path.split(".").pop() || "jpeg";
    return { buffer, extension };
  }

  // ─── Financeiro ─────────────────────────────────────────────────────────────

  async financeApprove(id: string, userId?: string): Promise<PdvSalesRequest> {
    await this.assertStatus(id, PdvSalesRequestStatus.PENDING_FINANCE);
    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_CD21_ANALYSIS, {
      userId,
      description: "Comprovante aprovado pelo financeiro",
    });
  }

  async financeReject(
    id: string,
    params: { note: string; userId?: string },
  ): Promise<PdvSalesRequest> {
    await this.assertStatus(id, PdvSalesRequestStatus.PENDING_FINANCE);

    const errors: PdvSalesRequestErrors = {
      origin: PdvCorrectionOrigin.FINANCE,
      reasons: [PdvCorrectionReason.PAYMENT_RECEIPT],
      note: params.note,
    };

    await this.repository.update(id, {
      correction_origin_status: PdvSalesRequestStatus.PENDING_FINANCE,
      errors,
    });

    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_CORRECTION, {
      userId: params.userId,
      description: `Devolvido pelo financeiro: ${params.note}`,
    });
  }

  // ─── CD21 — análise ─────────────────────────────────────────────────────────

  async cd21AnalysisApprove(
    id: string,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertStatus(
      id,
      PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
    );

    // Pedido pode chegar aqui já com nota de venda emitida (gerada direto na
    // Bling antes da análise do CD21) — nesse caso não faz sentido passar por
    // PENDING_NF_SALE, já pula pro próximo passo real do fluxo.
    const order = await orderService.findById(request.order_id);
    if (order?.invoice_id) {
      if (order.invoice_id !== request.sale_invoice_id) {
        await this.repository.update(id, { sale_invoice_id: order.invoice_id });
      }
      return this.transitionTo(
        id,
        this.resolvePostSaleInvoiceTarget(request.shipping_type),
        {
          userId,
          description:
            "Pedido aprovado na análise do CD21 — nota de venda já existente",
        },
      );
    }

    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_NF_SALE, {
      userId,
      description: "Pedido aprovado na análise do CD21",
    });
  }

  async cd21AnalysisReject(
    id: string,
    params: { reasons: PdvCorrectionReason[]; note: string; userId?: string },
  ): Promise<PdvSalesRequest> {
    await this.assertStatus(id, PdvSalesRequestStatus.PENDING_CD21_ANALYSIS);

    const errors: PdvSalesRequestErrors = {
      origin: PdvCorrectionOrigin.CD21_ANALYSIS,
      reasons: params.reasons,
      note: params.note,
    };

    await this.repository.update(id, {
      correction_origin_status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
      errors,
    });

    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_CORRECTION, {
      userId: params.userId,
      description: `Devolvido pela análise do CD21: ${params.note}`,
    });
  }

  // Zera só a nota de transferência (sale_invoice_id nunca é zerado) e manda
  // de volta pro início da análise — usado por cd21ResolveInvoiceCancelled e
  // resolveCorrection.
  private async resetForCd21AnalysisRetry(
    id: string,
    params: { userId?: string; description: string },
  ): Promise<PdvSalesRequest> {
    await this.repository.update(id, { transfer_invoice_id: null });
    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_CD21_ANALYSIS, params);
  }

  // ─── Correção (loja resolve) ────────────────────────────────────────────────

  async resolveCorrection(
    id: string,
    params: {
      userId?: string;
      decision?: "CANCEL" | "EXCHANGE_PRODUCT" | "RETRY_ANALYSIS";
    },
  ): Promise<PdvSalesRequest> {
    const request = await this.assertStatus(
      id,
      PdvSalesRequestStatus.PENDING_CORRECTION,
    );

    if (!request.correction_origin_status) {
      throw new Error("Solicitação sem origem de correção registrada");
    }

    // Correção de comprovante (origem financeiro) não passa por aqui — é
    // resolvida anexando um comprovante novo (attachReceipt) + confirmando
    // (confirmReceiptSubmission), que já reenvia pro financeiro sozinho.
    if (
      request.correction_origin_status === PdvSalesRequestStatus.PENDING_FINANCE
    ) {
      throw new Error(
        "Correção de comprovante é resolvida anexando um novo comprovante, não por este endpoint",
      );
    }

    if (
      request.correction_origin_status &&
      EXPEDITION_PDV_SALES_REQUEST_STATUSES.includes(
        request.correction_origin_status,
      )
    ) {
      if (!params.decision) {
        throw new Error(
          'Correção vinda da expedição exige "decision": CANCEL ou EXCHANGE_PRODUCT',
        );
      }

      const target =
        params.decision === "CANCEL"
          ? PdvSalesRequestStatus.CANCELLED
          : PdvSalesRequestStatus.PENDING_CD21_ANALYSIS;

      return this.transitionTo(id, target, {
        userId: params.userId,
        description:
          params.decision === "CANCEL"
            ? "Loja optou por cancelar o pedido após problema na expedição"
            : "Loja optou por trocar o produto — reanálise do CD21",
      });
    }

    // Origem INVOICE_CANCELLED: CD21 devolveu pra loja decidir — ou ela já
    // cancelou o pedido na Bling (CANCEL), ou corrigiu o que precisava e quer
    // repetir o processo (RETRY_ANALYSIS, mesmo reset de notas que o CD21
    // faria direto).
    if (
      request.correction_origin_status ===
      PdvSalesRequestStatus.INVOICE_CANCELLED
    ) {
      if (params.decision !== "CANCEL" && params.decision !== "RETRY_ANALYSIS") {
        throw new Error(
          'Correção vinda de nota cancelada exige "decision": CANCEL ou RETRY_ANALYSIS',
        );
      }

      if (params.decision === "CANCEL") {
        return this.transitionTo(id, PdvSalesRequestStatus.CANCELLED, {
          userId: params.userId,
          description:
            "Loja optou por cancelar o pedido na Bling após nota cancelada",
        });
      }

      return this.resetForCd21AnalysisRetry(id, {
        userId: params.userId,
        description: "Loja corrigiu o necessário — reanálise do CD21",
      });
    }

    // Única origem restante aqui é CD21_ANALYSIS — o ajuste em si (produto,
    // dados do pedido) é feito direto na Bling e reflete sozinho no pedido
    // via sync; este endpoint só confirma que foi corrigido e manda de volta
    // pra reanálise.
    await this.assertShippingInfoFilledIfRequired(request);
    return this.transitionTo(id, request.correction_origin_status, {
      userId: params.userId,
      description: "Correção confirmada pela loja — reanálise do CD21",
    });
  }

  // ─── Faturamento ────────────────────────────────────────────────────────────

  // Dispara a emissão da NFe de venda na Bling pra este pedido — não avança
  // status sozinho: a transição real (syncSaleInvoiceFromOrder) só
  // acontece depois, quando o pipeline de sync de pedidos da Bling (webhook
  // ou fetch queue) confirmar order.invoice_id preenchido, o que cobre tanto
  // essa geração pelo sistema quanto uma geração feita manualmente na Bling.
  async generateSaleInvoice(id: string): Promise<PdvSalesRequest> {
    const request = await this.assertStatus(
      id,
      PdvSalesRequestStatus.PENDING_NF_SALE,
    );
    await nfeEmissionService.emitForOrder(request.order_id);
    return request;
  }

  private async markSaleInvoiceReady(
    id: string,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertStatus(
      id,
      PdvSalesRequestStatus.PENDING_NF_SALE,
    );

    // Re-sincroniza com order.invoice_id em vez de confiar cegamente no
    // valor copiado na criação — a Bling pode ter vinculado a nota depois.
    const order = await orderService.findById(request.order_id);
    if (order?.invoice_id && order.invoice_id !== request.sale_invoice_id) {
      await this.repository.update(id, { sale_invoice_id: order.invoice_id });
    }

    return this.transitionTo(
      id,
      this.resolvePostSaleInvoiceTarget(request.shipping_type),
      {
        userId,
        description: "NF de venda gerada",
      },
    );
  }

  // Fonte de verdade da nota de venda é order.invoice_id — re-sincroniza
  // sale_invoice_id antes de devolver, pra lote/romaneio nunca usarem uma
  // cópia defasada.
  async resolveSaleInvoiceId(id: string): Promise<string> {
    const request = await this.findById(id, {
      attributes: ["id", "order_id", "sale_invoice_id", "unit_business_id", "status"],
    });
    if (!request) throw new Error("Solicitação não encontrada");

    const order = await orderService.findById(request.order_id, {
      attributes: ["id", "invoice_id"],
    });
    if (!order?.invoice_id) {
      throw new Error("Pedido ainda não possui nota de venda");
    }

    if (order.invoice_id !== request.sale_invoice_id) {
      await this.repository.update(id, { sale_invoice_id: order.invoice_id });
      notifySalesRequestChanged(request);
    }
    return order.invoice_id;
  }

  // Compartilhado entre markSaleInvoiceReady (avanço normal a partir de
  // PENDING_NF_SALE) e cd21AnalysisApprove (pedido que já chega com nota de
  // venda emitida e pula PENDING_NF_SALE) — mesma regra ADT nos dois casos.
  private resolvePostSaleInvoiceTarget(
    shippingType: PdvShippingType | null,
  ): PdvSalesRequestStatus {
    return shippingType === PdvShippingType.ADT
      ? PdvSalesRequestStatus.PENDING_NF_TRANSFER
      : PdvSalesRequestStatus.SHIP_TODAY;
  }

  // Chamado pelo sync de pedidos da Bling quando order.invoice_id resolve:
  // espelha em sale_invoice_id de qualquer status ativo (não só PENDING_NF_SALE)
  // e avisa o PDV, senão a cópia fica nula até alguém reabrir a solicitação.
  async syncSaleInvoiceFromOrder(
    orderId: string,
    invoiceId: string,
  ): Promise<void> {
    const request = await this.repository.findActiveByOrderId(orderId);
    if (!request) return;

    // Romaneio da nota de venda já gerado no CD21: finaliza direto, sem
    // passar pelo fluxo de status.
    if (await this.isSaleInvoiceDeliveryNoteGenerated(invoiceId)) {
      if (request.sale_invoice_id !== invoiceId) {
        await this.repository.update(request.id, {
          sale_invoice_id: invoiceId,
        });
      }
      await this.finishByDeliveryNote(request.id);
      return;
    }

    if (request.status === PdvSalesRequestStatus.PENDING_NF_SALE) {
      await this.markSaleInvoiceReady(request.id);
      return;
    }

    if (request.sale_invoice_id === invoiceId) return;

    await this.repository.update(request.id, { sale_invoice_id: invoiceId });
    notifySalesRequestChanged(request);
  }

  // Autocomplete do front pra buscar uma nota de transferência já existente
  // no sistema — não altera nada, é só leitura.
  async searchTransferInvoiceCandidates(query: string) {
    if (!query || query.trim().length < 2) return [];

    const tecinco = await getTCarIntegration();

    return invoiceService.findAll({
      where: {
        integrations_id: tecinco.id,
        [Op.or]: [
          { number_system: { [Op.iLike]: `%${query}%` } },
          { id_system: { [Op.iLike]: `%${query}%` } },
        ],
      },
      attributes: [
        "id",
        "number_system",
        "id_system",
        "xml_key",
        "receiver_name",
        "emitted_at",
      ],
      limit: 20,
    });
  }

  // DANFE da nota de venda ou de transferência vinculada — mesmo endpoint pra
  // ambas, já que as duas são só um invoiceId. Confere que a nota pertence a
  // ESTA solicitação antes de servir (nunca pega o id de outra por engano);
  // a geração/serving em si é responsabilidade do invoiceService, nunca lida
  // com Invoice diretamente aqui.
  async getInvoiceDanfeBuffer(id: string, invoiceId: string): Promise<Buffer> {
    const request = await this.repository.findById(id);
    if (!request) throw new Error("Solicitação não encontrada");

    if (
      request.sale_invoice_id !== invoiceId &&
      request.transfer_invoice_id !== invoiceId
    ) {
      throw new Error("Nota não pertence a esta solicitação");
    }

    return invoiceService.getDanfeBuffer(invoiceId);
  }

  // NÃO avança status sozinho — só vincula/troca a nota de transferência e
  // devolve a solicitação atualizada pro front validar. Permitido em
  // PENDING_NF_TRANSFER (primeira vinculação), SHIPPING e FINISHED (edição
  // depois de já confirmado — CD21/expedição percebeu a nota errada, ou
  // reabertura pontual pós-finalização) — sempre como TROCA (nunca deixa
  // `transfer_invoice_id` nulo: quem chama precisa mandar uma nota válida
  // pra substituir a atual). Em SHIPPING/FINISHED, só permite a troca se o
  // romaneio da nota de VENDA ainda não foi gerado — depois de gerado, o
  // pedido já saiu fisicamente com a nota de transferência que está
  // vinculada, trocar aqui só bagunçaria o que já foi expedido.
  async attachTransferInvoice(
    id: string,
    params: {
      invoiceId?: string;
      xmlBuffer?: Buffer;
      danfeBuffer?: Buffer;
      danfeMimeType?: string;
      tcarUpsertQueue: TCarInvoiceQueue;
      userId?: string;
    },
  ): Promise<{ salesRequest: PdvSalesRequest; message: string }> {
    const request = await this.assertStatus(id, [
      PdvSalesRequestStatus.PENDING_NF_TRANSFER,
      PdvSalesRequestStatus.SHIPPING,
      PdvSalesRequestStatus.FINISHED,
    ]);

    await this.assertSaleInvoiceDeliveryNoteNotGenerated(
      request.sale_invoice_id,
    );

    const tecinco = await getTCarIntegration();
    let invoiceId = params.invoiceId ?? null;
    let pendingTransferInvoiceImport = false;

    if (!invoiceId) {
      if (params.xmlBuffer) {
        const xmlContent = params.xmlBuffer.toString("utf-8");
        const accessKey = extractAccessKeyFromXmlContent(xmlContent);

        const branchId = await this.resolveBranchId(
          request.unit_business_id,
        );
        if (!branchId) {
          throw new Error(
            "Não foi possível resolver a filial Tecinco do pedido",
          );
        }

        // Valida o XML contra a API da Tecinco (pela chave de acesso) e já
        // upserta a invoice com os itens conciliados — reaproveita o mesmo
        // método usado pela importação manual de XML.
        await params.tcarUpsertQueue.upsertInvoiceFromXml(
          xmlContent,
          branchId,
        );

        const upserted = accessKey
          ? await invoiceService.findOne({ where: { xml_key: accessKey } })
          : null;
        if (!upserted) {
          throw new Error("Falha ao localizar a nota após importar o XML");
        }
        invoiceId = upserted.id;
      } else if (params.danfeBuffer) {
        const {
          accessKey,
          number,
          emitterCnpj: nativeEmitterCnpj,
        } = await extractDanfeIdentification(
          params.danfeBuffer,
          params.danfeMimeType ?? "application/pdf",
        );
        if (!accessKey || !number) {
          throw new Error(
            "Não foi possível ler a chave de acesso e o número da nota no DANFE — envie o XML da nota",
          );
        }

        let found = await invoiceService.findOne({
          where: { xml_key: accessKey },
        });

        // Não achou localmente: em vez de esperar a busca/importação real na
        // Tecinco (lenta — login, rate limit global, itens da nota), vincula
        // na hora uma nota PROVISÓRIA (só o número + o próprio DANFE
        // enviado) e enfileira o processo lento em background — ver
        // invoiceService.createStub e TCarInvoiceQueue "invoice_transfer".
        // A filial Tecinco é a de quem EMITIU a nota de transferência, nunca
        // a loja que abriu a solicitação PDV — as duas podem ser diferentes.
        if (!found) {
          // Sem fallback de IA aqui por decisão explícita (ver
          // danfe-interpreter.ts) — só o que a regex local achou no PDF.
          const emitterCnpj = nativeEmitterCnpj;
          if (!emitterCnpj) {
            throw new Error(
              "Não foi possível ler o CNPJ do emitente no DANFE — envie o XML da nota",
            );
          }

          const branchId = await this.resolveBranchIdByCnpj(emitterCnpj);
          if (!branchId) {
            throw new Error(
              "Não foi possível resolver a filial Tecinco a partir do CNPJ do emitente da nota",
            );
          }

          const stubId = randomUUID();
          const tempFile = await tempFileService.create({
            buffer: params.danfeBuffer,
            mime_type: params.danfeMimeType ?? "application/pdf",
            original_filename: `${accessKey}.pdf`,
            upload_directory: "/danfes",
            preserve_filename: true,
            entity_type: "INVOICE_DANFE",
            entity_id: stubId,
          });

          found = await invoiceService.createStub({
            id: stubId,
            integrationsId: tecinco.id,
            numberSystem: number,
            idSystem: accessKey,
            xmlKey: accessKey,
            danfePath: buildTempFileSentinelPath(tempFile.id),
            senderCnpj: emitterCnpj,
          });

          await uploaderQueue.enqueueUpload(tempFile.id, "INVOICE_DANFE");
          pendingTransferInvoiceImport = true;

          await params.tcarUpsertQueue.add(
            {
              eventId: `invoice-transfer-${stubId}`,
              resource: "invoice_transfer",
              action: "sync",
              companyId: "",
              branchId,
              data: {
                numero: number,
                chaveAcesso: accessKey,
                pdvSalesRequestId: id,
                transferInvoiceId: stubId,
              },
            },
            `tecinco-invoice-transfer-${stubId}`,
          );
        }

        invoiceId = found.id;

      } else {
        throw new Error(
          "Informe o id de uma nota já existente, ou anexe XML/DANFE",
        );
      }
    }

    const invoice = await invoiceService.findById(invoiceId);
    if (!invoice) {
      throw new Error("Nota fiscal não encontrada");
    }
    if (invoice.integrations_id !== tecinco.id) {
      throw new Error(
        "A nota de transferência precisa ser da integração Tecinco",
      );
    }

    const wasAlreadyLinked = !!request.transfer_invoice_id;

    const updated = await this.repository.update(id, {
      transfer_invoice_id: invoiceId,
    });
    if (!updated) throw new Error("Solicitação não encontrada");

    const productsMatch = pendingTransferInvoiceImport
      ? null
      : await this.getTransferInvoiceProductsMatch(
          request.sale_invoice_id,
          invoiceId,
        );
    const salesRequest = await this.repository.update(id, {
      transfer_invoice_products_match_sale: productsMatch,
    });
    if (!salesRequest) throw new Error("Solicitação não encontrada");

    await this.logAction(request, {
      userId: params.userId,
      description: wasAlreadyLinked
        ? "Nota de transferência substituída"
        : "Nota de transferência vinculada",
    });

    return {
      salesRequest,
      message: pendingTransferInvoiceImport
        ? "Nota de transferência anexada. Buscando dados na Tecinco."
        : "Nota de transferência anexada com sucesso",
    };
  }

  // Reexecutada pelo worker quando a nota provisória termina de ser importada.
  // expectedTransferInvoiceId impede que um job antigo sobrescreva uma troca.
  async validateTransferInvoiceProducts(
    requestId: string,
    expectedTransferInvoiceId?: string,
  ): Promise<void> {
    const request = await this.repository.findById(requestId);
    if (
      !request?.sale_invoice_id ||
      !request.transfer_invoice_id ||
      (expectedTransferInvoiceId &&
        request.transfer_invoice_id !== expectedTransferInvoiceId)
    ) {
      return;
    }

    const productsMatch = await this.getTransferInvoiceProductsMatch(
      request.sale_invoice_id,
      request.transfer_invoice_id,
    );
    await this.repository.update(request.id, {
      transfer_invoice_products_match_sale: productsMatch,
    });
  }

  private async getTransferInvoiceProductsMatch(
    saleInvoiceId: string | null,
    transferInvoiceId: string,
  ): Promise<boolean | null> {
    if (!saleInvoiceId) return null;

    const [saleItems, transferItems] = await Promise.all([
      invoiceItemsService.findAll({
        where: { invoice_id: saleInvoiceId },
        attributes: ["product_id", "quantity_expected"],
      }),
      invoiceItemsService.findAll({
        where: { invoice_id: transferInvoiceId },
        attributes: ["product_id", "quantity_expected"],
      }),
    ]);

    return invoiceProductsMatch(saleItems, transferItems);
  }

  // Confirmação explícita do front — só agora a solicitação avança pra
  // SHIPPING. Exige que uma nota de transferência já tenha sido vinculada
  // (attachTransferInvoice). Só a partir de PENDING_NF_TRANSFER — uma
  // solicitação já em SHIPPING não tem mais o que confirmar aqui, editar a
  // nota nesse ponto é só attachTransferInvoice mesmo, sem transição.
  async confirmTransferInvoice(
    id: string,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertStatus(
      id,
      PdvSalesRequestStatus.PENDING_NF_TRANSFER,
    );

    if (!request.transfer_invoice_id) {
      throw new Error("Vincule uma nota de transferência antes de confirmar");
    }

    return this.transitionTo(id, PdvSalesRequestStatus.SHIPPING, {
      userId,
      description: "Nota de transferência confirmada",
    });
  }

  // ─── Expedição ──────────────────────────────────────────────────────────────

  async expeditionReject(
    id: string,
    params: { reasons: PdvCorrectionReason[]; note: string; userId?: string },
  ): Promise<PdvSalesRequest> {
    const request = await this.assertStatus(id, [
      ...EXPEDITION_PDV_SALES_REQUEST_STATUSES,
    ]);

    const errors: PdvSalesRequestErrors = {
      origin: PdvCorrectionOrigin.EXPEDITION,
      reasons: params.reasons,
      note: params.note,
    };

    await this.repository.update(id, {
      correction_origin_status: request.status,
      errors,
    });

    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_CORRECTION, {
      userId: params.userId,
      description: `Devolvido pela expedição: ${params.note}`,
    });
  }

  async finish(id: string, userId?: string): Promise<PdvSalesRequest> {
    await this.assertStatus(id, [...EXPEDITION_PDV_SALES_REQUEST_STATUSES]);
    return this.transitionTo(id, PdvSalesRequestStatus.FINISHED, {
      userId,
      description: "Romaneio gerado — solicitação finalizada",
    });
  }

  // Sem assertStatus de propósito: romaneio da nota de venda gerado finaliza
  // de qualquer status ativo (terminais já ficam fora da busca).
  private async finishByDeliveryNote(id: string): Promise<PdvSalesRequest> {
    return this.transitionTo(id, PdvSalesRequestStatus.FINISHED, {
      description: "Romaneio gerado — solicitação finalizada",
    });
  }

  // Chamado por batch.service.ts::generateDeliveryNote sempre que um
  // romaneio é gerado — finaliza qualquer solicitação ativa cuja nota de
  // VENDA tenha romaneio (o da nota de transferência não é exigido).
  async finishIfDeliveryNoteGenerated(invoiceIds: string[]): Promise<void> {
    if (!invoiceIds.length) return;

    const candidates =
      await this.repository.findActiveBySaleInvoiceIds(invoiceIds);
    if (!candidates.length) return;

    // Romaneio de PDV é sempre gerado pelo CD21 (única tela que aciona
    // finish/gera lote de saída pra esse fluxo) — checagem de
    // delivery_note_generated_at precisa ser escopada a ela, senão um lote
    // de OUTRA loja pra essa mesma nota daria falso positivo.
    const cd21 = await unitBusinessService.getCd21UnitBusiness();
    if (!cd21) throw new Error("Unidade CD21 não cadastrada");

    const saleInvoiceIds = Array.from(
      new Set(
        candidates
          .map((request) => request.sale_invoice_id)
          .filter((invoiceId): invoiceId is string => !!invoiceId),
      ),
    );
    const readyInvoiceIds = new Set(
      await invoiceService.findDeliveryNoteGeneratedInvoiceIds(
        saleInvoiceIds,
        cd21.id,
      ),
    );

    for (const request of candidates) {
      const saleReady =
        !!request.sale_invoice_id && readyInvoiceIds.has(request.sale_invoice_id);

      if (saleReady) await this.finishByDeliveryNote(request.id);
    }
  }

  // Fato puro, sem lançar erro — usado tanto pela guarda de
  // attachTransferInvoice (assertSaleInvoiceDeliveryNoteNotGenerated) quanto
  // por canEditTransferInvoice (pro front decidir se exibe o componente de
  // troca, sem precisar tentar a troca e tratar o 400). Mesma escopagem por
  // CD21 de finishIfDeliveryNoteGenerated (uma nota pode estar em lote de
  // mais de uma loja). Sem sale_invoice_id ainda (PENDING_NF_TRANSFER), não
  // há romaneio possível.
  private async isSaleInvoiceDeliveryNoteGenerated(
    saleInvoiceId: string | null,
  ): Promise<boolean> {
    if (!saleInvoiceId) return false;

    const cd21 = await unitBusinessService.getCd21UnitBusiness();
    if (!cd21) throw new Error("Unidade CD21 não cadastrada");

    const [generatedInvoiceId] =
      await invoiceService.findDeliveryNoteGeneratedInvoiceIds(
        [saleInvoiceId],
        cd21.id,
      );

    return !!generatedInvoiceId;
  }

  // Guarda de attachTransferInvoice pra SHIPPING/FINISHED.
  private async assertSaleInvoiceDeliveryNoteNotGenerated(
    saleInvoiceId: string | null,
  ): Promise<void> {
    if (await this.isSaleInvoiceDeliveryNoteGenerated(saleInvoiceId)) {
      throw new Error(
        "Não é possível trocar a nota de transferência — o romaneio da nota de venda já foi gerado",
      );
    }
  }

  // Pro front decidir se mostra o componente de troca de nota de
  // transferência, sem precisar disparar attachTransferInvoice só pra
  // descobrir se vai tomar 400. Mesmas duas condições de
  // attachTransferInvoice: status elegível + (em SHIPPING/FINISHED) romaneio
  // da nota de venda ainda não gerado.
  async canEditTransferInvoice(id: string): Promise<boolean> {
    const request = await this.repository.findById(id);
    if (!request) throw new Error("Solicitação não encontrada");

    const editableStatuses = [
      PdvSalesRequestStatus.PENDING_NF_TRANSFER,
      PdvSalesRequestStatus.SHIPPING,
      PdvSalesRequestStatus.FINISHED,
    ];
    if (!editableStatuses.includes(request.status)) return false;

    return !(await this.isSaleInvoiceDeliveryNoteGenerated(
      request.sale_invoice_id,
    ));
  }

  // ─── Cancelamento de nota fiscal (Bling/Tecinco) ────────────────────────────
  // Chamado a partir de invoice-xml.ts e bling-api-fetch.queue.ts quando uma
  // invoice é detectada como cancelada — não decide sozinho pra onde volta,
  // fica bloqueado em INVOICE_CANCELLED até o CD21 decidir via
  // cd21ResolveInvoiceCancelled (ou a loja, via resolveCorrection, se o CD21
  // preferir devolver pra ela).

  async handleInvoiceCancelled(invoiceId: string): Promise<void> {
    const affected =
      await this.repository.findActiveBySaleOrTransferInvoiceId(invoiceId);

    for (const request of affected) {
      const isTransfer = request.transfer_invoice_id === invoiceId;

      await this.transitionTo(
        request.id,
        PdvSalesRequestStatus.INVOICE_CANCELLED,
        {
          description: isTransfer
            ? "Nota de transferência vinculada foi cancelada"
            : "Nota de venda vinculada foi cancelada",
        },
      );
    }
  }

  // Decisão do CD21 diante de INVOICE_CANCELLED: reenviar direto pra
  // reanálise (zerando as notas vinculadas pra repetir o processo dali) ou
  // devolver pra loja decidir (cancelar o pedido na Bling ou corrigir o
  // necessário — resolvido depois via resolveCorrection).
  async cd21ResolveInvoiceCancelled(
    id: string,
    params: {
      decision: "RETRY_ANALYSIS" | "REQUEST_CORRECTION";
      userId?: string;
      note?: string;
    },
  ): Promise<PdvSalesRequest> {
    await this.assertStatus(id, PdvSalesRequestStatus.INVOICE_CANCELLED);

    if (params.decision === "RETRY_ANALYSIS") {
      return this.resetForCd21AnalysisRetry(id, {
        userId: params.userId,
        description: "CD21 optou por reenviar para análise após nota cancelada",
      });
    }

    const errors: PdvSalesRequestErrors = {
      origin: PdvCorrectionOrigin.INVOICE_CANCELLED,
      reasons: [PdvCorrectionReason.INVOICE_CANCELLED],
      note: params.note ?? "Nota fiscal cancelada",
    };

    await this.repository.update(id, {
      correction_origin_status: PdvSalesRequestStatus.INVOICE_CANCELLED,
      errors,
    });

    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_CORRECTION, {
      userId: params.userId,
      description:
        "CD21 devolveu pra loja após nota cancelada — cancelar o pedido na Bling ou corrigir",
    });
  }

  // ─── Cancelamento de pedido (Bling) ─────────────────────────────────────────
  // Chamado a partir de order-status.ts sempre que um pedido é marcado
  // CANCELLED na Bling — diferente de handleInvoiceCancelled (bloqueia em
  // INVOICE_CANCELLED pra decisão humana): aqui o pedido em si já foi
  // cancelado na origem, não há o que decidir, vai direto pra CANCELLED.
  // No-op se não houver solicitação ativa pro pedido (findActiveByOrderId já
  // exclui os status terminais).
  async cancelIfActiveByOrderId(orderId: string): Promise<void> {
    const request = await this.repository.findActiveByOrderId(orderId);
    if (!request) return;

    await this.transitionTo(request.id, PdvSalesRequestStatus.CANCELLED, {
      description: "Pedido cancelado na Bling",
    });
  }

  // ─── Exclusão ───────────────────────────────────────────────────────────────
  // Só permitido em OPEN (nunca saiu do lugar) ou PENDING_CORRECTION (devolvida
  // pra loja) — qualquer outro status já tem nota/pedido em andamento na Bling/
  // Tecinco, resolve pelo fluxo de correção/cancelamento em vez de apagar.
  // Nunca apaga a linha: zera tudo exceto sale_invoice_id, apaga comprovantes
  // (arquivo + linha) e histórico, e transiciona pra EXCLUDED — mantém o
  // order_id pra reabrir criação de nova solicitação (findActiveByOrderId
  // trata EXCLUDED como terminal).
  async deleteRequest(id: string): Promise<void> {
    const request = await this.repository.findById(id);
    if (!request) throw new Error("Solicitação não encontrada");

    if (
      request.status !== PdvSalesRequestStatus.OPEN &&
      request.status !== PdvSalesRequestStatus.PENDING_CORRECTION
    ) {
      throw new Error(
        "Exclusão não é permitida — resolva pelo fluxo de correção/cancelamento.",
      );
    }

    // Um arquivo por comprovante — em paralelo (Promise.all), nunca um await
    // por iteração (N+1).
    const receipts = await pdvSalesRequestReceiptService.findAllByRequestId(id);
    await Promise.all(
      receipts.map((receipt) =>
        uploaderQueue
          .enqueueDelete(
            resolveDeleteTarget(receipt.path),
            "PDV_SALES_REQUEST_RECEIPT",
            buildEntityCacheKey("PDV_SALES_REQUEST_RECEIPT", receipt.id),
          )
          .catch((err) =>
            console.warn(
              "[PDV] Falha ao enfileirar limpeza do comprovante ao excluir solicitação",
              err,
            ),
          ),
      ),
    );

    await sequelize.transaction(async (t) => {
      await pdvSalesRequestReceiptService.deleteAllByRequestId(id);
      await pdvSalesRequestHistoryService.deleteAllByRequestId(id);

      await this.repository.update(
        id,
        {
          status: PdvSalesRequestStatus.EXCLUDED,
          transfer_invoice_id: null,
          correction_origin_status: null,
          shipping_type: null,
          shipping_address: null,
          transporter_name: null,
          payment_receipt_analysis: null,
          payment_receipt_validated: null,
          payment_method_matches_receipt: null,
          receipt_total_matches_order: null,
          receipt_total_difference: null,
          transfer_invoice_products_match_sale: null,
          errors: null,
        },
        { transaction: t },
      );
    });

    notifySalesRequestChanged({
      id: request.id,
      unit_business_id: request.unit_business_id,
      status: PdvSalesRequestStatus.EXCLUDED,
    });
  }

  // Pra quem muda dado exibido na solicitação fora deste service (lote/romaneio do CD21, import da Tecinco).
  async notifyChanged(id: string): Promise<void> {
    try {
      const request = await this.findById(id, {
        attributes: ["id", "unit_business_id", "status"],
      });
      if (request) notifySalesRequestChanged(request);
    } catch (err) {
      console.warn("[PDV] Falha ao notificar atualização da solicitação", err);
    }
  }

  // Lote finalizado muda o expedition_progress das solicitações das notas dele — Kanban recebe 1 sync por loja, não 1 por solicitação.
  async notifyChangedBySaleInvoiceIds(invoiceIds: string[]): Promise<void> {
    try {
      const requests = await this.repository.findActiveBySaleInvoiceIds(
        invoiceIds,
        ["id", "unit_business_id", "status"],
      );
      requests.forEach((request) => notifySalesRequestUpdated(request.id));
      notifyPdvStoresSync(requests, "SALES_REQUEST_STATUS_CHANGED");
    } catch (err) {
      console.warn("[PDV] Falha ao notificar solicitações do lote", err);
    }
  }

  async getHistory(id: string) {
    return pdvSalesRequestHistoryService.findAll({
      where: { pdv_sales_request_id: id },
      attributes: ["id", "step", "description", "date", "user_id"],
      order: [["date", "DESC"]],
    });
  }
}

export default new PdvSalesRequestService();
