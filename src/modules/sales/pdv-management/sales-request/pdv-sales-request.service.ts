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
  EMPTY_PAYMENT_RECEIPT_EXTRACTION,
  PdvSalesRequestOrderDetail,
  PdvSalesRequestOrderSummary,
  TERMINAL_PDV_SALES_REQUEST_STATUSES,
} from "./pdv-sales-request.types";
import pdvSalesRequestHistoryService from "../sales-request-history/pdv-sales-request-history.service";
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
import { PaymentReceiptExtractionSchema } from "./helpers/payment-receipt-extraction.schema";
import { paymentMethodMatchesReceipt } from "./helpers/payment-method-match";
import { QueryParams } from "../../../../shared/query/query.types";
import socketService from "../../../handlers/socket/services/socket.service";
import {
  PDV_SOCKET_NAMESPACE,
  pdvSalesRequestRoom,
  PAYMENT_RECEIPT_ANALYSIS_DONE_EVENT,
} from "./helpers/pdv-sales-request-room";
import { notifyPdvStoreSync } from "./helpers/notify-pdv-store-sync";
import { PDV_EXCLUDED_STORE_NUMBERS } from "../helpers/pdv-excluded-unit-business";

// Fingerprint duplicado em OUTRA solicitação — tipo próprio pra distinguir
// esse caso de qualquer outro erro dentro do job assíncrono de análise.
export class DuplicateReceiptError extends Error {}

// Teto de segurança pra findEligibleOrders — sem paginação própria ainda,
// ver .claude/entities/pdv-sales-request/index.md ("Card do Kanban").
const ELIGIBLE_ORDERS_LIMIT = 200;

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
      ],
      sortableFields: ["createdAt", "status"],
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
    name: string;
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
          name: params.name,
          payment_receipt_path: null,
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

  // ─── Loja: comprovante + tipo de envio ──────────────────────────────────────

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
  // em background (ver runReceiptAnalysisAsync) — nunca bloqueia o anexo por
  // falha/demora da extração (documento ilegível, OCR malformado, ou análise
  // passando de RECEIPT_ANALYSIS_TIMEOUT_MS): financeiro revisa manualmente,
  // análise segue com os campos em null. Duplicidade de comprovante é a única
  // falha tratada como erro de verdade dentro do job (ver
  // DuplicateReceiptError/finalizeReceiptAnalysis).
  private async analyzeReceipt(
    requestId: string,
    orderId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{
    payment_receipt_analysis: PaymentReceiptExtraction | null;
    payment_receipt_validated: boolean | null;
    payment_receipt_fingerprint: string | null;
    payment_method_matches_receipt: boolean | null;
  }> {
    let result;
    try {
      result = await this.withReceiptAnalysisTimeout(
        paymentReceiptExtractionService.analyze(buffer, mimeType),
      );
    } catch (err) {
      console.warn(
        "[PDV] Falha ao analisar comprovante — seguindo sem análise",
        err,
      );
      return {
        payment_receipt_analysis: null,
        payment_receipt_validated: null,
        payment_receipt_fingerprint: null,
        payment_method_matches_receipt: null,
      };
    }

    return this.finalizeReceiptAnalysis(
      requestId,
      orderId,
      result.extraction,
      result.validated,
      result.fingerprint,
    );
  }

  // Compartilhado entre a análise automática (IA, a partir do buffer) e a
  // edição manual do front (updateReceiptAnalysis) — mesma checagem de
  // duplicidade (única falha que bloqueia de propósito, ver
  // .claude/modules/ai-vision-extraction.md) e o mesmo cálculo de match com a
  // forma de pagamento do pedido.
  private async finalizeReceiptAnalysis(
    requestId: string,
    orderId: string,
    extraction: PaymentReceiptExtraction,
    validated: boolean | null,
    fingerprint: string | null,
  ): Promise<{
    payment_receipt_analysis: PaymentReceiptExtraction;
    payment_receipt_validated: boolean | null;
    payment_receipt_fingerprint: string | null;
    payment_method_matches_receipt: boolean | null;
  }> {
    if (fingerprint) {
      const duplicate =
        await this.repository.findByReceiptFingerprint(fingerprint);
      if (duplicate && duplicate.id !== requestId) {
        throw new DuplicateReceiptError(
          "Este comprovante já foi utilizado em outra solicitação",
        );
      }
    }

    const order = await orderService.findByIdWithPaymentMethod(orderId);
    const paymentMethodDescription =
      (order as any)?.paymentMethod?.description ?? null;

    return {
      payment_receipt_analysis: extraction,
      payment_receipt_validated: validated,
      payment_receipt_fingerprint: fingerprint,
      payment_method_matches_receipt: paymentMethodMatchesReceipt(
        paymentMethodDescription,
        extraction.tipo_comprovante,
      ),
    };
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

  // NÃO avança status sozinho — só grava comprovante/tipo de envio e devolve
  // a solicitação atualizada pro front validar. Editando um comprovante já
  // existente, apaga o arquivo antigo do uploader só depois que o novo já
  // está salvo e referenciado no banco. Análise por IA roda em background
  // (runReceiptAnalysisAsync) — ver .claude/modules/ai-vision-extraction.md.
  async attachReceiptAndShippingType(
    id: string,
    params: {
      buffer: Buffer;
      filename: string;
      mimeType: string;
      shippingType: PdvShippingType;
      userId?: string;
    },
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id);
    const previousPath = request.payment_receipt_path;

    // Escopado por solicitação — upload é determinístico por nome de arquivo
    // (preserveFilename), duas lojas com nome de foto igual se sobrescreveriam
    // num diretório único.
    const path = await uploaderService.upload({
      buffer: params.buffer,
      filename: params.filename,
      mimeType: params.mimeType,
      directory: `/pdv-receipts/${id}`,
      preserveFilename: true,
    });

    const updated = await this.repository.update(id, {
      payment_receipt_path: path,
      shipping_type: params.shippingType,
      payment_receipt_analysis: null,
      payment_receipt_validated: null,
      payment_receipt_fingerprint: null,
      payment_method_matches_receipt: null,
    });
    if (!updated) throw new Error("Solicitação não encontrada");

    if (previousPath && previousPath !== path) {
      try {
        await uploaderService.delete(previousPath);
      } catch (err) {
        console.warn(
          "[PDV] Falha ao apagar comprovante antigo do uploader",
          err,
        );
      }
    }

    await this.logAction(id, request.status, {
      userId: params.userId,
      description: previousPath
        ? "Comprovante substituído"
        : "Comprovante e tipo de envio anexados",
    });

    // .catch aqui é só rede de segurança pra erro inesperado não virar
    // unhandledRejection — o job já trata AI/duplicidade internamente.
    this.runReceiptAnalysisAsync(
      id,
      request.order_id,
      path,
      params.buffer,
      params.mimeType,
    ).catch((err) =>
      console.error(
        "[PDV] Falha inesperada na análise assíncrona do comprovante",
        err,
      ),
    );

    return updated;
  }

  // Roda em background, depois do attach já ter respondido. Reconfere
  // payment_receipt_path antes de gravar — se a loja trocou o comprovante de
  // novo enquanto essa análise rodava, descarta (resultado é de arquivo velho).
  private async runReceiptAnalysisAsync(
    requestId: string,
    orderId: string,
    uploadedPath: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    try {
      const analysis = await this.analyzeReceipt(
        requestId,
        orderId,
        buffer,
        mimeType,
      );

      const current = await this.repository.findById(requestId);
      if (!current || current.payment_receipt_path !== uploadedPath) return;

      await this.repository.update(requestId, analysis);

      socketService.emitToNamespaceRoom(
        PDV_SOCKET_NAMESPACE,
        pdvSalesRequestRoom(requestId),
        PAYMENT_RECEIPT_ANALYSIS_DONE_EVENT,
        {
          requestId,
          success: true,
          analysis: analysis.payment_receipt_analysis,
          validated: analysis.payment_receipt_validated,
          paymentMethodMatchesReceipt: analysis.payment_method_matches_receipt,
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
  // PENDING_FINANCE. Exige que comprovante + tipo de envio já tenham sido
  // anexados (attachReceiptAndShippingType).
  async confirmReceiptSubmission(
    id: string,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id);

    if (!request.payment_receipt_path || !request.shipping_type) {
      throw new Error(
        "Anexe o comprovante e o tipo de envio antes de confirmar",
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

  // Loja corrige manualmente um ou mais campos da análise (a IA pode errar,
  // ex.: comprovante de maquininha mostra o apelido da máquina em vez do
  // nome do banco) antes de confirmar pro financeiro — mesma janela de
  // edição do comprovante em si (assertReceiptEditable), nunca depois de
  // confirmado. `updates` é parcial: só os campos enviados são sobrescritos,
  // o resto da análise atual é preservado. Revalida/recalcula validated,
  // fingerprint (com a mesma checagem de duplicidade) e o match com a forma
  // de pagamento — os três dependem do conteúdo da análise, e editar um
  // campo-chave (ex.: valor_total) sem recalcular deixaria os outros três
  // desatualizados.
  async updateReceiptAnalysis(
    id: string,
    updates: Partial<PaymentReceiptExtraction>,
    userId?: string,
  ): Promise<PdvSalesRequest> {
    const request = await this.assertReceiptEditable(id);
    if (!request.payment_receipt_path) {
      throw new Error("Anexe um comprovante antes de editar a análise");
    }

    const parsedUpdates = PaymentReceiptExtractionSchema.partial().parse(updates);
    const merged: PaymentReceiptExtraction = {
      ...(request.payment_receipt_analysis ?? EMPTY_PAYMENT_RECEIPT_EXTRACTION),
      ...parsedUpdates,
    };

    const { validated, fingerprint } =
      paymentReceiptExtractionService.computeDerived(merged);
    const fields = await this.finalizeReceiptAnalysis(
      id,
      request.order_id,
      merged,
      validated,
      fingerprint,
    );

    const updated = await this.repository.update(id, fields);
    if (!updated) throw new Error("Solicitação não encontrada");

    await this.logAction(id, request.status, {
      userId,
      description: "Análise do comprovante editada manualmente",
    });

    return updated;
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
    // resolvida anexando um comprovante novo (attachReceiptAndShippingType),
    // que já reenvia pro financeiro sozinho.
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

  // NÃO avança status sozinho — só vincula/troca a nota de transferência e
  // devolve a solicitação atualizada pro front validar. Permitido tanto em
  // PENDING_NF_TRANSFER (primeira vinculação) quanto em SHIPPING (edição
  // depois de já confirmado, ex.: CD21/expedição percebeu a nota errada) —
  // sempre como TROCA (nunca deixa `transfer_invoice_id` nulo: quem chama
  // precisa mandar uma nota válida pra substituir a atual).
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
    ]);

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

    if (request.payment_receipt_path) {
      try {
        await uploaderService.delete(request.payment_receipt_path);
      } catch (err) {
        console.warn(
          "[PDV] Falha ao apagar comprovante do uploader ao excluir solicitação",
          err,
        );
      }
    }

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
