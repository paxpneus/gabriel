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
import { paymentMethodMatchesReceipt } from "./helpers/payment-method-match";
import { QueryParams } from "../../../../shared/query/query.types";

// Teto de segurança pra findEligibleOrders — sem paginação própria ainda,
// ver .claude/entities/pdv-sales-request/index.md ("Card do Kanban").
const ELIGIBLE_ORDERS_LIMIT = 200;

export class PdvSalesRequestService extends BaseService<
  PdvSalesRequest,
  PdvSalesRequestRepository
> {
  constructor() {
    super(pdvSalesRequestRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
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

  // Listagem (cards reduzidos do Kanban) — só cliente + loja, sem forma de
  // pagamento/parcelas/itens.
  async paginateWithOrder(params: QueryParams, forcedWhere?: WhereOptions) {
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
  async findEligibleOrders(
    unitBusinessId: string,
  ): Promise<PdvSalesRequestOrderSummary[]> {
    console.log("LOJA", unitBusinessId)
    const orders = await orderService.findByUnitBusiness(
      unitBusinessId,
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
    return sequelize.transaction(async (t) => {
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

    return sequelize.transaction(async (t) => {
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
  }

  // ─── Loja: comprovante + tipo de envio ──────────────────────────────────────

  // Roda a extração por IA (Gemini) e a checagem de duplicidade ANTES do
  // upload pro uploader — barato desistir aqui se for duplicado, sem gastar
  // uma chamada de storage à toa. Nunca bloqueia o anexo por falha da IA em
  // si (Gemini fora do ar, resposta malformada): o financeiro ainda revisa
  // manualmente, então segue com os campos de análise em null. A duplicidade
  // de comprovante É bloqueante — é o único caso em que a IA de fato barra o
  // fluxo (pedido do usuário: "Este comprovante já foi utilizado...").
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
    const empty = {
      payment_receipt_analysis: null,
      payment_receipt_validated: null,
      payment_receipt_fingerprint: null,
      payment_method_matches_receipt: null,
    };

    let result;
    try {
      result = await paymentReceiptExtractionService.analyze(buffer, mimeType);
    } catch (err) {
      console.warn(
        "[PDV] Falha ao analisar comprovante via IA — seguindo sem análise",
        err,
      );
      return empty;
    }

    if (result.fingerprint) {
      const duplicate = await this.repository.findByReceiptFingerprint(
        result.fingerprint,
      );
      if (duplicate && duplicate.id !== requestId) {
        throw new Error(
          "Este comprovante já foi utilizado em outra solicitação",
        );
      }
    }

    const order = await orderService.findByIdWithPaymentMethod(orderId);
    const paymentMethodDescription =
      (order as any)?.paymentMethod?.description ?? null;

    return {
      payment_receipt_analysis: result.extraction,
      payment_receipt_validated: result.validated,
      payment_receipt_fingerprint: result.fingerprint,
      payment_method_matches_receipt: paymentMethodMatchesReceipt(
        paymentMethodDescription,
        result.extraction.tipo_comprovante,
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
  // a solicitação atualizada pro front validar. Pode ser chamado quantas
  // vezes precisar (troca de arquivo, ajuste do tipo de envio) enquanto não
  // for confirmado via confirmReceiptSubmission. Editando um comprovante já
  // existente, apaga o arquivo antigo do uploader só depois que o novo já
  // está salvo e referenciado no banco — nunca fica sem nenhum arquivo
  // referenciado em caso de falha no meio do caminho.
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

    const analysis = await this.analyzeReceipt(
      id,
      request.order_id,
      params.buffer,
      params.mimeType,
    );

    const path = await uploaderService.upload({
      buffer: params.buffer,
      filename: params.filename,
      mimeType: params.mimeType,
      directory: "/pdv-receipts",
      preserveFilename: true,
    });

    const updated = await this.repository.update(id, {
      payment_receipt_path: path,
      shipping_type: params.shippingType,
      ...analysis,
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

    return updated;
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
    await this.assertStatus(id, PdvSalesRequestStatus.PENDING_CD21_ANALYSIS);
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

    const target =
      request.shipping_type === PdvShippingType.ADT
        ? PdvSalesRequestStatus.PENDING_NF_TRANSFER
        : PdvSalesRequestStatus.SHIPPING;

    return this.transitionTo(id, target, {
      userId,
      description: "NF de venda gerada",
    });
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

  async getHistory(id: string) {
    return pdvSalesRequestHistoryService.findAll({
      where: { pdv_sales_request_id: id },
      order: [["date", "ASC"]],
    });
  }
}

export default new PdvSalesRequestService();
