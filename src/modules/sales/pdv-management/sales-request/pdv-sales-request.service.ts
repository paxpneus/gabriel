import { Op, WhereOptions } from "sequelize";
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
  PaymentReceiptExtraction,
  PaymentReceiptReconciledAnalysis,
  EMPTY_PAYMENT_RECEIPT_EXTRACTION,
  PdvSalesRequestOrderDetail,
  PdvSalesRequestOrderSummary,
  TERMINAL_PDV_SALES_REQUEST_STATUSES,
} from "./pdv-sales-request.types";
import pdvSalesRequestHistoryService from "../sales-request-history/pdv-sales-request-history.service";
import pdvSalesRequestReceiptService from "../sales-request-receipt/pdv-sales-request-receipt.service";
import PdvSalesRequestReceipt from "../sales-request-receipt/pdv-sales-request-receipt.model";
import { extractAccessKeyFromDanfe } from "./helpers/danfe-interpreter";
import orderService from "../../orders/order/orders.service";
import invoiceService from "../../../warehouse/fiscal/invoices/invoice/invoice.service";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import uploaderService from "../../../handlers/uploader/services/uploader.service";
import { getTCarIntegration } from "../../../handlers/tecinco/api/tecinco_api";
import { TCarUpsertQueue } from "../../../handlers/tecinco/queues/tecinco-api-fetch.queue";
import { extractAccessKeyFromXmlContent } from "../../../../shared/utils/xml/access-key";
import nfeEmissionService from "../../../handlers/bling/services/bling-nfe/nfe-emission.service";
import paymentReceiptExtractionService from "./payment-receipt-extraction.service";
import {
  PaymentReceiptExtractionSchema,
  PaymentReceiptReconciledAnalysisSchema,
} from "./helpers/payment-receipt-extraction.schema";
import { paymentMethodMatchesReceipt } from "./helpers/payment-method-match";
import {
  reconcileReceiptAnalyses,
  reconcileReceiptValidation,
  receiptTotalMatchesOrder,
} from "./helpers/receipt-reconciliation";
import { QueryParams } from "../../../../shared/query/query.types";
import socketService from "../../../handlers/socket/services/socket.service";
import {
  PDV_SOCKET_NAMESPACE,
  pdvSalesRequestRoom,
  PAYMENT_RECEIPT_ANALYSIS_DONE_EVENT,
  PDV_SALES_REQUEST_UPDATED_EVENT,
} from "./helpers/pdv-sales-request-room";
import { notifyPdvStoreSync } from "./helpers/notify-pdv-store-sync";
import { PDV_EXCLUDED_STORE_NUMBERS } from "../helpers/pdv-excluded-unit-business";
import {
  orderNumberSystemMatchesLiteral,
  orderCustomerNameMatchesLiteral,
  orderDateWithinLiteral,
  errorsReasonsOverlapLiteral,
} from "./helpers/custom-filters";

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
      ],
      sortableFields: ["createdAt", "status"],
      customFields: {
        // WHERE fragment sobre a association "order" já embutida em
        // findPaginatedWithOrder — só um filtro isolado, não precisa de
        // método novo na repository (ver "list-filters" no CLAUDE.md).
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
      },
    };
  }

  // ─── Leitura enriquecida (card do Kanban) ────────────────────────────────────
  // Pedido (Bling) embutido na resposta — ver "Card do Kanban" em
  // .claude/entities/pdv-sales-request/index.md.

  private toOrderDetail(order: any): PdvSalesRequestOrderDetail | null {
    if (!order) return null;

    const parcelas = order.source_payload?.parcelas;

    return {
      id: order.id,
      number_order_channel: order.number_order_channel,
      number_order_system: order.number_order_system ?? null,
      date: order.date ?? null,
      total_order: order.total_order ?? null,
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
      paymentMethod: order.paymentMethod
        ? { id: order.paymentMethod.id, description: order.paymentMethod.description }
        : null,
      installments: Array.isArray(parcelas) ? parcelas.length : null,
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
      total_order: order.total_order ?? null,
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

  // Detalhe (tela expandida do card) — pedido com cliente, forma de
  // pagamento, parcelas e itens.
  async findByIdWithOrder(id: string): Promise<any | null> {
    const record = await this.repository.findByIdWithOrder(id);
    if (!record) return null;

    const plain = record.get({ plain: true }) as any;
    return { ...plain, order: this.toOrderDetail(plain.order) };
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

  // Loja explicitamente fora do fluxo PDV (CD21, ou PDV_EXCLUDED_STORE_NUMBERS)
  // — diferente do caso "sem loja selecionada" acima, aqui a loja É uma
  // específica, só que uma que nunca participa do PDV. Único lugar que
  // precisa buscar a UnitBusiness pelo id pra checar (as outras exclusões
  // já filtram na origem, por número, sem precisar de round-trip extra).
  private async isExcludedFromPdvFlow(unitBusinessId: string): Promise<boolean> {
    const [unitBusiness, cd21] = await Promise.all([
      unitBusinessService.findById(unitBusinessId),
      unitBusinessService.getCd21UnitBusiness(),
    ]);
    if (!unitBusiness) return false;
    if (cd21 && unitBusiness.id === cd21.id) return true;
    return PDV_EXCLUDED_STORE_NUMBERS.includes(unitBusiness.number ?? "");
  }

  // Listagem (cards reduzidos do Kanban) — só cliente + loja, sem forma de
  // pagamento/parcelas/itens. unitBusinessId null (CD21/Financeiro/
  // Televendas sem loja) enxerga todas as lojas físicas normais.
  async paginateWithOrder(params: QueryParams, unitBusinessId: string | null) {
    const scope = await this.resolveUnitBusinessScope(unitBusinessId);
    const forcedWhere: WhereOptions = {
      unit_business_id: Array.isArray(scope) ? { [Op.in]: scope } : scope,
    };

    const result = await this.repository.findPaginatedWithOrder(
      params,
      this.queryConfig,
      forcedWhere,
    );

    return {
      ...result,
      data: result.data.map((record) => {
        const plain = (record as any).get({ plain: true }) as any;
        return { ...plain, order: this.toOrderSummary(plain.order) };
      }),
    };
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

  // Card expandido de um pedido de /orders/eligible, ainda sem
  // PdvSalesRequest — mesma forma que findByIdWithOrder, buscada por order_id.
  async findOrderDetail(
    orderId: string,
  ): Promise<PdvSalesRequestOrderDetail | null> {
    const order = await orderService.findByIdWithFullDetail(orderId);
    if (!order) return null;

    return this.toOrderDetail(order.get({ plain: true }));
  }

  // Chamado por bling-order.service.ts::createOrderFromBling (só create,
  // nunca update) sempre que um pedido nasce — cria a PdvSalesRequest vazia
  // (status OPEN sempre) já junto do pedido, pro front só precisar atrelar
  // os dados depois em vez de dar o passo extra de "Criar solicitação".
  // Mesmos 3 critérios de findEligibleOrders/isEligibleForPdv: loja física
  // normal (fora de CD21/PDV_EXCLUDED_STORE_NUMBERS, nunca marketplace sem
  // unit_business_id), pedido não CANCELLED, sem romaneio já gerado pro
  // invoice/loja do pedido (não deveria acontecer pra um pedido recém-
  // -criado, mas reusa o mesmo critério em vez de assumir). No-op
  // silencioso pra qualquer pedido não elegível.
  async createEmptyRequestForNewOrderIfEligible(orderId: string): Promise<void> {
    const order = await orderService.findById(orderId);
    if (!order?.unit_business_id) return;
    if (await this.isExcludedFromPdvFlow(order.unit_business_id)) return;
    if (!(await orderService.isEligibleForPdv(orderId))) return;

    await this.createRequest({ orderId });
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

    notifyPdvStoreSync(updated.unit_business_id, "SALES_REQUEST_STATUS_CHANGED");

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

  // Registra uma ação que NÃO muda `status` (edição de comprovante/nota de
  // transferência antes de confirmar) — todo o resto do histórico passa por
  // transitionTo, mas "cada ação na solicitação" (spec original do módulo)
  // inclui edições que ainda não avançaram etapa. `step` repete o status
  // atual, já que ele não mudou.
  private async logAction(
    id: string,
    step: PdvSalesRequestStatus,
    params: { userId?: string; description: string },
  ): Promise<void> {
    await pdvSalesRequestHistoryService.create({
      pdv_sales_request_id: id,
      step,
      description: params.description,
      date: new Date(),
      user_id: params.userId ?? null,
    });
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

    notifyPdvStoreSync(created.unit_business_id, "SALES_REQUEST_STATUS_CHANGED");

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

  // Front conectado na room desta solicitação (mesma usada pelo evento de
  // análise de comprovante) só usa isso pra decidir refetch — nunca lê dado
  // de negócio do payload, mesmo espírito de notifyPdvStoreSync.
  private notifySalesRequestUpdated(requestId: string): void {
    socketService.emitToNamespaceRoom(
      PDV_SOCKET_NAMESPACE,
      pdvSalesRequestRoom(requestId),
      PDV_SALES_REQUEST_UPDATED_EVENT,
      { requestId },
    );
  }

  // Recalcula e persiste payment_receipt_analysis/validated/
  // payment_method_matches_receipt a partir de TODOS os comprovantes
  // atualmente anexados — chamado depois de qualquer mutação numa linha de
  // comprovante (criar, editar análise, apagar). payment_method_matches_receipt
  // só é calculado com exatamente 1 comprovante: com 2+, os tipos podem
  // divergir entre si (ex.: PIX + cartão) e a comparação 1:1 contra
  // order.paymentMethod não faz mais sentido — financeiro revisa manualmente.
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

    // Busca a order uma vez só — usada tanto pro match de forma de
    // pagamento (só com 1 comprovante) quanto pro match de valor total
    // (sempre, qualquer quantidade de comprovantes).
    const order = await orderService.findByIdWithPaymentMethod(orderId);

    let matchesReceipt: boolean | null = null;
    if (receipts.length === 1 && receipts[0].analysis) {
      const paymentMethodDescription =
        (order as any)?.paymentMethod?.description ?? null;
      matchesReceipt = paymentMethodMatchesReceipt(
        paymentMethodDescription,
        receipts[0].analysis.tipo_comprovante,
      );
    }

    const totalMatchesOrder = receiptTotalMatchesOrder(
      analysis?.valor_total ?? null,
      (order as any)?.total_order ?? null,
    );

    const updated = await this.repository.update(requestId, {
      payment_receipt_analysis: analysis,
      payment_receipt_validated: validated,
      payment_method_matches_receipt: matchesReceipt,
      receipt_total_matches_order: totalMatchesOrder,
    });
    if (!updated) throw new Error("Solicitação não encontrada");

    this.notifySalesRequestUpdated(requestId);

    return updated;
  }

  // Também serve pra resolver uma correção vinda do financeiro (comprovante
  // rejeitado): a loja não "decide" nada num endpoint de correção genérico,
  // ela resolve anexando um comprovante novo — mas só depois de confirmar
  // (confirmReceiptSubmission), não automaticamente aqui.
  private async assertReceiptEditable(id: string): Promise<PdvSalesRequest> {
    const request = await this.assertStatus(id, [
      PdvSalesRequestStatus.OPEN,
      PdvSalesRequestStatus.PENDING_CORRECTION,
    ]);

    if (
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
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id);

    const updated = await this.repository.update(id, {
      shipping_type: shippingType,
    });
    if (!updated) throw new Error("Solicitação não encontrada");

    await this.logAction(id, request.status, {
      userId,
      description: "Tipo de envio definido",
    });

    return updated;
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
      userId?: string;
    },
  ): Promise<PdvSalesRequestReceipt> {
    const request = await this.assertReceiptEditable(id);

    // Diretório por solicitação — nome do arquivo gerado (sem
    // preserveFilename) pra não colidir entre comprovantes diferentes.
    const path = await uploaderService.upload({
      buffer: params.buffer,
      filename: params.filename,
      mimeType: params.mimeType,
      directory: `/pdv-receipts/${id}`,
    });

    const receipt = await pdvSalesRequestReceiptService.create({
      pdv_sales_request_id: id,
      path,
      analysis: null,
      validated: null,
      fingerprint: null,
      created_by_user_id: params.userId ?? null,
    });

    await this.logAction(id, request.status, {
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
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id);
    const receipt = await pdvSalesRequestReceiptService.findById(receiptId);
    if (!receipt || receipt.pdv_sales_request_id !== id) {
      throw new Error("Comprovante não encontrado nesta solicitação");
    }

    await pdvSalesRequestReceiptService.delete(receiptId);

    try {
      await uploaderService.delete(receipt.path);
    } catch (err) {
      console.warn("[PDV] Falha ao apagar comprovante do uploader", err);
    }

    const updated = await this.reconcileReceipts(id, request.order_id);

    await this.logAction(id, request.status, {
      userId,
      description: "Comprovante removido",
    });

    return updated;
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

      await pdvSalesRequestReceiptService.update(receiptId, {
        analysis: result.analysis,
        validated: result.validated,
        fingerprint: result.fingerprint,
      });

      const reconciled = await this.reconcileReceipts(requestId, orderId);

      socketService.emitToNamespaceRoom(
        PDV_SOCKET_NAMESPACE,
        pdvSalesRequestRoom(requestId),
        PAYMENT_RECEIPT_ANALYSIS_DONE_EVENT,
        {
          requestId,
          receiptId,
          success: true,
          analysis: result.analysis,
          validated: result.validated,
          reconciled: {
            analysis: reconciled.payment_receipt_analysis,
            validated: reconciled.payment_receipt_validated,
            paymentMethodMatchesReceipt:
              reconciled.payment_method_matches_receipt,
            totalMatchesOrder: reconciled.receipt_total_matches_order,
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
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id);
    const receipts =
      await pdvSalesRequestReceiptService.findAllByRequestId(id);

    if (!receipts.length || !request.shipping_type) {
      throw new Error(
        "Anexe ao menos um comprovante e o tipo de envio antes de confirmar",
      );
    }

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
    updates: Partial<PaymentReceiptExtraction>,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id);
    const receipt = await pdvSalesRequestReceiptService.findById(receiptId);
    if (!receipt || receipt.pdv_sales_request_id !== id) {
      throw new Error("Comprovante não encontrado nesta solicitação");
    }

    const parsedUpdates = PaymentReceiptExtractionSchema.partial().parse(updates);
    const merged: PaymentReceiptExtraction = {
      ...(receipt.analysis ?? EMPTY_PAYMENT_RECEIPT_EXTRACTION),
      ...parsedUpdates,
    };

    const { validated, fingerprint } =
      paymentReceiptExtractionService.computeDerived(merged);
    await this.assertReceiptNotDuplicate(fingerprint, receiptId);

    await pdvSalesRequestReceiptService.update(receiptId, {
      analysis: merged,
      validated,
      fingerprint,
    });

    const updated = await this.reconcileReceipts(id, request.order_id);

    await this.logAction(id, request.status, {
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
  // não sobre o resumo). receipt_total_matches_order É recalculado — é
  // literalmente a comparação do campo que este endpoint acabou de mudar
  // (valor_total) contra order.total_order, deixaria o aviso desatualizado
  // se não recalculasse.
  async updatePaymentReceiptAnalysis(
    id: string,
    updates: Partial<PaymentReceiptReconciledAnalysis>,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id);

    const parsedUpdates =
      PaymentReceiptReconciledAnalysisSchema.partial().parse(updates);
    const merged: PaymentReceiptReconciledAnalysis = {
      ...(request.payment_receipt_analysis ?? EMPTY_PAYMENT_RECEIPT_EXTRACTION),
      ...parsedUpdates,
    };

    const order = await orderService.findById(request.order_id);
    const totalMatchesOrder = receiptTotalMatchesOrder(
      merged.valor_total,
      (order as any)?.total_order ?? null,
    );

    const updated = await this.repository.update(id, {
      payment_receipt_analysis: merged,
      receipt_total_matches_order: totalMatchesOrder,
    });
    if (!updated) throw new Error("Solicitação não encontrada");

    await this.logAction(id, request.status, {
      userId,
      description: "Resumo do pagamento editado manualmente",
    });

    this.notifySalesRequestUpdated(id);

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

    const buffer = await uploaderService.getFile(receipt.path);
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

  // Zera as notas vinculadas e manda de volta pro início da análise — usado
  // tanto quando o CD21 decide reenviar direto (cd21ResolveInvoiceCancelled)
  // quanto quando a loja resolve uma correção de nota cancelada corrigindo o
  // necessário (resolveCorrection).
  private async resetForCd21AnalysisRetry(
    id: string,
    params: { userId?: string; description: string },
  ): Promise<PdvSalesRequest> {
    await this.repository.update(id, {
      sale_invoice_id: null,
      transfer_invoice_id: null,
    });
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

    if (request.correction_origin_status === PdvSalesRequestStatus.SHIPPING) {
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

    // Origem FINISHED: CD21 reabriu uma solicitação já finalizada e pediu
    // pra loja corrigir algo pontual sem refazer as notas (ver
    // correctFinishedRequest) — a loja resolve fisicamente/direto na Bling e
    // este endpoint só confirma, voltando direto pra FINISHED (não passa por
    // SHIPPING de novo).
    if (request.correction_origin_status === PdvSalesRequestStatus.FINISHED) {
      return this.transitionTo(id, PdvSalesRequestStatus.FINISHED, {
        userId: params.userId,
        description: "Correção confirmada pela loja — solicitação finalizada novamente",
      });
    }

    // Única origem restante aqui é CD21_ANALYSIS — o ajuste em si (produto,
    // dados do pedido) é feito direto na Bling e reflete sozinho no pedido
    // via sync; este endpoint só confirma que foi corrigido e manda de volta
    // pra reanálise.
    return this.transitionTo(id, request.correction_origin_status, {
      userId: params.userId,
      description: "Correção confirmada pela loja — reanálise do CD21",
    });
  }

  // ─── Faturamento ────────────────────────────────────────────────────────────

  // Dispara a emissão da NFe de venda na Bling pra este pedido — não avança
  // status sozinho: a transição real (markSaleInvoiceReadyIfPending) só
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

  // Compartilhado entre markSaleInvoiceReady (avanço normal a partir de
  // PENDING_NF_SALE) e cd21AnalysisApprove (pedido que já chega com nota de
  // venda emitida e pula PENDING_NF_SALE) — mesma regra ADT nos dois casos.
  private resolvePostSaleInvoiceTarget(
    shippingType: PdvShippingType | null,
  ): PdvSalesRequestStatus {
    return shippingType === PdvShippingType.ADT
      ? PdvSalesRequestStatus.PENDING_NF_TRANSFER
      : PdvSalesRequestStatus.SHIPPING;
  }

  // Chamado pelo sync de pedidos da Bling (bling-order.service.ts) sempre
  // que order.invoice_id é (re)resolvido — no-op se não houver solicitação
  // ativa em PENDING_NF_SALE pro pedido, já que a maioria dos pedidos
  // sincronizados não é do fluxo PDV.
  async markSaleInvoiceReadyIfPending(orderId: string): Promise<void> {
    const request = await this.repository.findActiveByOrderId(orderId);
    if (!request || request.status !== PdvSalesRequestStatus.PENDING_NF_SALE) {
      return;
    }
    await this.markSaleInvoiceReady(request.id);
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
      tcarUpsertQueue: TCarUpsertQueue;
      userId?: string;
    },
  ): Promise<PdvSalesRequest> {
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
        const accessKey = await extractAccessKeyFromDanfe(
          params.danfeBuffer,
          params.danfeMimeType ?? "application/pdf",
        );
        if (!accessKey) {
          throw new Error(
            "Não foi possível ler a chave de acesso do DANFE — envie o XML da nota",
          );
        }

        const found = await invoiceService.findOne({
          where: { xml_key: accessKey },
        });
        if (!found) {
          throw new Error(
            "Nota não encontrada no sistema a partir do DANFE — envie o XML da nota de transferência",
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

    await this.logAction(id, request.status, {
      userId: params.userId,
      description: wasAlreadyLinked
        ? "Nota de transferência substituída"
        : "Nota de transferência vinculada",
    });

    return updated;
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
    await this.assertStatus(id, PdvSalesRequestStatus.SHIPPING);

    const errors: PdvSalesRequestErrors = {
      origin: PdvCorrectionOrigin.EXPEDITION,
      reasons: params.reasons,
      note: params.note,
    };

    await this.repository.update(id, {
      correction_origin_status: PdvSalesRequestStatus.SHIPPING,
      errors,
    });

    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_CORRECTION, {
      userId: params.userId,
      description: `Devolvido pela expedição: ${params.note}`,
    });
  }

  async finish(id: string, userId?: string): Promise<PdvSalesRequest> {
    await this.assertStatus(id, PdvSalesRequestStatus.SHIPPING);
    return this.transitionTo(id, PdvSalesRequestStatus.FINISHED, {
      userId,
      description: "Romaneio gerado — solicitação finalizada",
    });
  }

  // Chamado por batch.service.ts::generateDeliveryNote sempre que um
  // romaneio é gerado — finaliza sozinho quem estava só esperando isso.
  // Finaliza só com o romaneio da nota de VENDA gerado — mesmo em ADT, o
  // romaneio da nota de transferência não é mais exigido pra finalizar.
  async finishIfDeliveryNoteGenerated(invoiceIds: string[]): Promise<void> {
    if (!invoiceIds.length) return;

    const candidates =
      await this.repository.findShippingBySaleOrTransferInvoiceIds(
        invoiceIds,
      );
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

      if (saleReady) await this.finish(request.id);
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

  // ─── Correção pós-finalização (CD21) ────────────────────────────────────────
  // finish() é terminal — depois de FINISHED, só este endpoint reabre a
  // solicitação. Duas decisões, sempre a critério do CD21 (mesma tela que já
  // aciona finish sozinha):
  // - REQUEST_CORRECTION (padrão): não mexe nas notas, só devolve pra loja
  //   com o motivo anexado — mesmo formato de errors dos outros origins.
  // - RESET_INVOICES: zera as duas notas e manda direto pra PENDING_NF_SALE,
  //   refazendo o faturamento do zero (nunca deixa pra reanálise do CD21 —
  //   os dados do pedido não são o problema, só as notas emitidas).
  async correctFinishedRequest(
    id: string,
    params: {
      decision: "REQUEST_CORRECTION" | "RESET_INVOICES";
      reasons?: PdvCorrectionReason[];
      note?: string;
      userId?: string;
    },
  ): Promise<PdvSalesRequest> {
    await this.assertStatus(id, PdvSalesRequestStatus.FINISHED);

    if (params.decision === "RESET_INVOICES") {
      await this.repository.update(id, {
        sale_invoice_id: null,
        transfer_invoice_id: null,
      });

      return this.transitionTo(id, PdvSalesRequestStatus.PENDING_NF_SALE, {
        userId: params.userId,
        description:
          "CD21 removeu as notas de uma solicitação finalizada — reenviado para faturamento",
      });
    }

    if (!params.note) {
      throw new Error("Informe o motivo da correção");
    }

    const errors: PdvSalesRequestErrors = {
      origin: PdvCorrectionOrigin.FINISHED,
      reasons: params.reasons?.length
        ? params.reasons
        : [PdvCorrectionReason.OTHER_INFO],
      note: params.note,
    };

    await this.repository.update(id, {
      correction_origin_status: PdvSalesRequestStatus.FINISHED,
      errors,
    });

    return this.transitionTo(id, PdvSalesRequestStatus.PENDING_CORRECTION, {
      userId: params.userId,
      description: `CD21 reabriu solicitação finalizada para correção: ${params.note}`,
    });
  }

  // ─── Exclusão ───────────────────────────────────────────────────────────────
  // Só permitido em OPEN (nunca saiu do lugar) ou PENDING_CORRECTION (devolvida
  // pra loja) — qualquer outro status já tem nota/pedido em andamento na Bling/
  // Tecinco, resolve pelo fluxo de correção/cancelamento em vez de apagar.
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
    // por iteração (N+1). As linhas em si somem sozinhas via onDelete:
    // CASCADE quando a solicitação for apagada logo abaixo.
    const receipts = await pdvSalesRequestReceiptService.findAllByRequestId(id);
    await Promise.all(
      receipts.map((receipt) =>
        uploaderService.delete(receipt.path).catch((err) =>
          console.warn(
            "[PDV] Falha ao apagar comprovante do uploader ao excluir solicitação",
            err,
          ),
        ),
      ),
    );

    await this.repository.delete(id);
  }

  async getHistory(id: string) {
    return pdvSalesRequestHistoryService.findAll({
      where: { pdv_sales_request_id: id },
      order: [["date", "DESC"]],
    });
  }
}

export default new PdvSalesRequestService();
