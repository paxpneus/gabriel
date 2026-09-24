import { Request, Response } from "express";
import multer from "multer";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import PdvSalesRequest from "./pdv-sales-request.model";
import pdvSalesRequestService, {
  PdvSalesRequestService,
} from "./pdv-sales-request.service";
import { PdvShippingType } from "./pdv-sales-request.types";
import { TCarUpsertQueue } from "../../../handlers/tecinco/queues/tecinco-api-fetch.queue";
import { pdvAccess, PdvAccessRequest } from "../pdv-access/pdv-access.middleware";
import { PdvAccessContext, PdvAccessScreen } from "../pdv-access/pdv-access.types";

const upload = multer({ storage: multer.memoryStorage() });

const READ_SCREENS = [
  PdvAccessScreen.STORE_REQUEST,
  PdvAccessScreen.FINANCE,
  PdvAccessScreen.CD21,
];

// Nenhuma rota exige login — acesso via pdvAccess() (link/token OU usuário
// logado), ver "Rotas e auth" em .claude/entities/pdv-sales-request/index.md.
export class PdvSalesRequestController extends BaseController<
  PdvSalesRequest,
  PdvSalesRequestService
> {
  constructor() {
    super(pdvSalesRequestService);

    // Solicitação pode ter mais de um comprovante anexado (ex.: 50% PIX +
    // 50% cartão) — POST adiciona, nunca substitui; pra trocar um errado,
    // DELETE + anexar outro.
    this.router.post(
      "/:id/shipping-type",
      pdvAccess([PdvAccessScreen.STORE_REQUEST]),
      this.setShippingType,
    );
    this.router.post(
      "/:id/receipt",
      pdvAccess([PdvAccessScreen.STORE_REQUEST]),
      upload.single("receipt"),
      this.attachReceipt,
    );
    this.router.delete(
      "/:id/receipt/:receiptId",
      pdvAccess([PdvAccessScreen.STORE_REQUEST]),
      this.deleteReceipt,
    );
    this.router.post(
      "/:id/receipt/confirm",
      pdvAccess([PdvAccessScreen.STORE_REQUEST]),
      this.confirmReceiptSubmission,
    );
    this.router.patch(
      "/:id/receipt/:receiptId/analysis",
      pdvAccess([PdvAccessScreen.STORE_REQUEST]),
      this.updateReceiptAnalysis,
    );
    // Edita o resumo CONCILIADO direto — nunca a análise de um comprovante
    // isolado (isso é PATCH /:id/receipt/:receiptId/analysis, acima).
    this.router.patch(
      "/:id/payment-receipt-analysis",
      pdvAccess([PdvAccessScreen.STORE_REQUEST]),
      this.updatePaymentReceiptAnalysis,
    );
    this.router.get(
      "/:id/receipt/:receiptId/image",
      pdvAccess(READ_SCREENS),
      this.getReceiptImage,
    );
    // Mesmo endpoint pra nota de venda e de transferência — invoiceId
    // validado contra a própria solicitação no service.
    this.router.get(
      "/:id/invoice/:invoiceId/danfe",
      pdvAccess(READ_SCREENS),
      this.getInvoiceDanfe,
    );
    this.router.post(
      "/:id/finance/approve",
      pdvAccess([PdvAccessScreen.FINANCE]),
      this.financeApprove,
    );
    this.router.post(
      "/:id/finance/reject",
      pdvAccess([PdvAccessScreen.FINANCE]),
      this.financeReject,
    );
    this.router.post(
      "/:id/cd21-analysis/approve",
      pdvAccess([PdvAccessScreen.CD21]),
      this.cd21AnalysisApprove,
    );
    this.router.post(
      "/:id/cd21-analysis/reject",
      pdvAccess([PdvAccessScreen.CD21]),
      this.cd21AnalysisReject,
    );
    this.router.post(
      "/:id/correction/resolve",
      pdvAccess([PdvAccessScreen.STORE_REQUEST]),
      this.resolveCorrection,
    );
    this.router.post(
      "/:id/invoice-cancelled/resolve",
      pdvAccess([PdvAccessScreen.CD21]),
      this.cd21ResolveInvoiceCancelled,
    );
    this.router.post(
      "/:id/sale-invoice/generate",
      pdvAccess([PdvAccessScreen.CD21]),
      this.generateSaleInvoice,
    );
    this.router.get(
      "/transfer-invoice/search",
      pdvAccess([PdvAccessScreen.CD21]),
      this.searchTransferInvoiceCandidates,
    );
    this.router.post(
      "/:id/transfer-invoice",
      pdvAccess([PdvAccessScreen.CD21]),
      upload.fields([
        { name: "xml", maxCount: 1 },
        { name: "danfe", maxCount: 1 },
      ]),
      this.attachTransferInvoice,
    );
    this.router.post(
      "/:id/transfer-invoice/confirm",
      pdvAccess([PdvAccessScreen.CD21]),
      this.confirmTransferInvoice,
    );
    // Leitura pro front decidir se mostra o botão de troca — sem precisar
    // chamar attachTransferInvoice só pra descobrir se toma 400.
    this.router.get(
      "/:id/transfer-invoice/editable",
      pdvAccess([PdvAccessScreen.CD21]),
      this.canEditTransferInvoice,
    );
    this.router.post(
      "/:id/expedition/reject",
      pdvAccess([PdvAccessScreen.CD21]),
      this.expeditionReject,
    );
    this.router.post(
      "/:id/finish",
      pdvAccess([PdvAccessScreen.CD21]),
      this.finish,
    );
    this.router.post(
      "/:id/correction/finished",
      pdvAccess([PdvAccessScreen.CD21]),
      this.correctFinishedRequest,
    );
    this.router.get(
      "/:id/history",
      pdvAccess(READ_SCREENS),
      this.getHistory,
    );
    // 2 segmentos de propósito — 1 segmento cairia em show() (GET /:id do
    // BaseController).
    this.router.get(
      "/orders/eligible",
      pdvAccess([PdvAccessScreen.STORE_REQUEST]),
      this.eligibleOrders,
    );
    // Precisa vir DEPOIS de "/orders/eligible" — mesmo formato de path, a
    // literal tem que vencer antes de :orderId.
    this.router.get(
      "/orders/:orderId",
      pdvAccess([PdvAccessScreen.STORE_REQUEST]),
      this.getOrderDetail,
    );
  }

  protected middlewaresFor() {
    return {
      index: [pdvAccess(READ_SCREENS)],
      show: [pdvAccess(READ_SCREENS)],
      create: [pdvAccess([PdvAccessScreen.STORE_REQUEST])],
      destroy: [pdvAccess([PdvAccessScreen.STORE_REQUEST])],
    };
  }

  private access(req: Request): PdvAccessContext {
    return (req as PdvAccessRequest).pdvAccess!;
  }

  // Via LOGIN, o autor é sempre o usuário logado (nunca o body) — o body só
  // é confiável pra ação anônima por link, sem usuário real.
  private actorUserId(req: Request): string | undefined {
    const access = this.access(req);
    return access.via === "LOGIN" ? access.userId : req.body?.userId;
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const access = this.access(req);
      const params = this.extractQueryParams(req);

      const result = await this.service.paginateWithOrder(
        params,
        access.unitBusinessId,
      );

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const access = this.access(req);
      const record = await this.service.findByIdWithOrder(
        req.params.id as string,
      );

      if (
        !record ||
        (access.unitBusinessId !== null &&
          record.unit_business_id !== access.unitBusinessId)
      ) {
        return res.status(404).json({ error: "Não encontrado" });
      }

      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const access = this.access(req);
      const { orderId, name } = req.body;

      const created = await this.service.createRequest({
        orderId,
        name,
        createdByUserId: this.actorUserId(req),
        unitBusinessId: access.unitBusinessId,
      });
      return res.status(201).json(created);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Toda mudança de estado passa pelos endpoints de transição abaixo — o
  // PUT/DELETE genérico do BaseController fica desabilitado pra não deixar
  // ninguém pular a máquina de estados (e o histórico que ela grava).
  update = async (_req: Request, res: Response): Promise<Response> => {
    return res
      .status(405)
      .json({
        error:
          "Atualização direta não é permitida — use os endpoints de transição de status.",
      });
  };

  // Permitido só em OPEN/PENDING_CORRECTION — a validação de status em si
  // fica no service (deleteRequest), aqui só ownership + tradução de erro.
  destroy = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      await this.service.deleteRequest(req.params.id as string);
      return res.status(204).send();
    } catch (error: any) {
      return res.status(405).json({ error: error.message });
    }
  };

  // Mesma razão de update/destroy: as ações em lote genéricas do
  // BaseController pulariam a máquina de estados (e o histórico) se
  // deixadas ativas.
  bulkCreate = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({
      error: "Criação em lote não é permitida — crie uma solicitação por vez.",
    });
  };

  bulkUpdate = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({
      error:
        "Atualização em lote não é permitida — use os endpoints de transição de status.",
    });
  };

  bulkDestroy = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({
      error:
        "Exclusão em lote não é permitida — resolva pelo fluxo de correção/cancelamento.",
    });
  };

  // Loja só age sobre solicitação da própria loja — 404 (não 403) se o :id
  // pertencer a outra, mesmo padrão de product_config.controller.ts.
  // unitBusinessId null (CD21/Financeiro, acesso global) pula a checagem —
  // qualquer solicitação é "própria" pra quem enxerga todas as lojas.
  private async assertOwnedByAccess(
    req: Request,
    res: Response,
  ): Promise<PdvSalesRequest | null> {
    const access = this.access(req);
    const record = await this.service.findById(req.params.id as string);

    if (
      !record ||
      (access.unitBusinessId !== null &&
        record.unit_business_id !== access.unitBusinessId)
    ) {
      res.status(404).json({ error: "Não encontrado" });
      return null;
    }

    return record;
  }

  // Separado do anexo de comprovante — shipping_type é propriedade da
  // solicitação, não de um comprovante específico (pode haver mais de um).
  // :id continua sendo o id da PdvSalesRequest — mas se não existir mais
  // nenhuma solicitação com esse id (ex.: pedido ainda não teve
  // POST / chamado por algum motivo), aceita orderId no body como fallback
  // pra criar a solicitação vazia na hora, igual createRequest, e já aplicar
  // o shipping_type nela.
  setShippingType = async (req: Request, res: Response): Promise<Response> => {
    try {
      const access = this.access(req);
      const requestedId = req.params.id as string;
      let record = await this.service.findById(requestedId);

      if (!record) {
        const { orderId } = req.body;
        if (!orderId) {
          return res.status(404).json({ error: "Não encontrado" });
        }
        record = await this.service.createRequest({
          orderId,
          createdByUserId: this.actorUserId(req),
          unitBusinessId: access.unitBusinessId,
        });
      } else if (
        access.unitBusinessId !== null &&
        record.unit_business_id !== access.unitBusinessId
      ) {
        return res.status(404).json({ error: "Não encontrado" });
      }

      const { shippingType } = req.body;
      const updated = await this.service.setShippingType(
        record.id,
        shippingType as PdvShippingType,
        this.actorUserId(req),
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Adiciona UM comprovante — nunca substitui os já anexados (ex.: 50% PIX +
  // 50% cartão). Devolve a linha do comprovante recém-criado, não a
  // solicitação inteira.
  attachReceipt = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      if (!req.file) {
        return res.status(400).json({ error: "Comprovante obrigatório" });
      }
      const receipt = await this.service.attachReceipt(
        req.params.id as string,
        {
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          userId: this.actorUserId(req),
        },
      );
      // Análise por IA roda em background — front deve entrar na room do
      // websocket (pdv-sales-request.socket.ts) e aguardar o resultado.
      return res
        .status(202)
        .json({ ...receipt.toJSON(), paymentReceiptAnalysisStatus: "PROCESSING" });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  deleteReceipt = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      const updated = await this.service.deleteReceipt(
        req.params.id as string,
        req.params.receiptId as string,
        this.actorUserId(req),
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  confirmReceiptSubmission = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      const updated = await this.service.confirmReceiptSubmission(
        req.params.id as string,
        this.actorUserId(req),
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  updateReceiptAnalysis = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      const updated = await this.service.updateReceiptAnalysis(
        req.params.id as string,
        req.params.receiptId as string,
        req.body,
        this.actorUserId(req),
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  updatePaymentReceiptAnalysis = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      const updated = await this.service.updatePaymentReceiptAnalysis(
        req.params.id as string,
        req.body,
        this.actorUserId(req),
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getReceiptImage = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;

      const { buffer, extension } = await this.service.getReceiptBuffer(
        req.params.id as string,
        req.params.receiptId as string,
      );

      res.set("Content-Type", `image/${extension}`);
      // "no-cache" força revalidar toda vez — ETag automático do Express
      // (res.send) resolve o 304 quando o conteúdo não mudou.
      res.set("Cache-Control", "no-cache");
      return res.send(buffer);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  getInvoiceDanfe = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;

      const buffer = await this.service.getInvoiceDanfeBuffer(
        req.params.id as string,
        req.params.invoiceId as string,
      );

      res.set("Content-Type", "application/pdf");
      res.set(
        "Content-Disposition",
        `inline; filename="danfe-${req.params.invoiceId}.pdf"`,
      );
      return res.send(buffer);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  financeApprove = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      const updated = await this.service.financeApprove(
        req.params.id as string,
        this.actorUserId(req),
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  financeReject = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      const { note } = req.body;
      const updated = await this.service.financeReject(
        req.params.id as string,
        { note, userId: this.actorUserId(req) },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  cd21AnalysisApprove = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const updated = await this.service.cd21AnalysisApprove(
        req.params.id as string,
        this.actorUserId(req),
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  cd21AnalysisReject = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { reasons, note } = req.body;
      const updated = await this.service.cd21AnalysisReject(
        req.params.id as string,
        { reasons, note, userId: this.actorUserId(req) },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  resolveCorrection = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      const { decision } = req.body;
      const updated = await this.service.resolveCorrection(
        req.params.id as string,
        { userId: this.actorUserId(req), decision },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  cd21ResolveInvoiceCancelled = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { decision, note } = req.body;
      const updated = await this.service.cd21ResolveInvoiceCancelled(
        req.params.id as string,
        { decision, userId: this.actorUserId(req), note },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Só dispara a emissão na Bling — o avanço de status é automático, feito
  // pelo sync de pedidos assim que order.invoice_id for confirmado (cobre
  // tanto essa geração quanto uma feita manualmente na Bling).
  generateSaleInvoice = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const updated = await this.service.generateSaleInvoice(
        req.params.id as string,
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  searchTransferInvoiceCandidates = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const query = String(req.query.q ?? "");
      const results =
        await this.service.searchTransferInvoiceCandidates(query);
      return res.json(results);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  attachTransferInvoice = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const files = req.files as
        | Record<string, Express.Multer.File[]>
        | undefined;
      const xmlFile = files?.xml?.[0];
      const danfeFile = files?.danfe?.[0];
      const { invoiceId } = req.body;

      const updated = await this.service.attachTransferInvoice(
        req.params.id as string,
        {
          invoiceId,
          xmlBuffer: xmlFile?.buffer,
          danfeBuffer: danfeFile?.buffer,
          danfeMimeType: danfeFile?.mimetype,
          tcarUpsertQueue: req.app.locals.TCarUpsertQueue as TCarUpsertQueue,
          userId: this.actorUserId(req),
        },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  confirmTransferInvoice = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const updated = await this.service.confirmTransferInvoice(
        req.params.id as string,
        this.actorUserId(req),
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  canEditTransferInvoice = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const editable = await this.service.canEditTransferInvoice(
        req.params.id as string,
      );
      return res.json({ editable });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  expeditionReject = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { reasons, note } = req.body;
      const updated = await this.service.expeditionReject(
        req.params.id as string,
        { reasons, note, userId: this.actorUserId(req) },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  finish = async (req: Request, res: Response): Promise<Response> => {
    try {
      const updated = await this.service.finish(
        req.params.id as string,
        this.actorUserId(req),
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  correctFinishedRequest = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { decision, reasons, note } = req.body;
      const updated = await this.service.correctFinishedRequest(
        req.params.id as string,
        { decision, reasons, note, userId: this.actorUserId(req) },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Coluna "Em Aberto" do Kanban — ver .claude/entities/pdv-sales-request/index.md.
  // unitBusinessId null (Televendas sem loja escolhida) traz de todas as
  // lojas físicas normais — resolvido em PdvSalesRequestService.
  eligibleOrders = async (req: Request, res: Response): Promise<Response> => {
    try {
      const access = this.access(req);
      const orders = await this.service.findEligibleOrders(
        access.unitBusinessId,
      );
      return res.json(orders);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Card expandido de pedido ainda sem solicitação (vindo de
  // /orders/eligible) — mesma forma que /:id embute, buscada por order_id.
  getOrderDetail = async (req: Request, res: Response): Promise<Response> => {
    try {
      const access = this.access(req);
      const order = await this.service.findOrderDetail(
        req.params.orderId as string,
      );

      if (
        !order ||
        (access.unitBusinessId !== null &&
          order.unitBusiness?.id !== access.unitBusinessId)
      ) {
        return res.status(404).json({ error: "Não encontrado" });
      }

      return res.json(order);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getHistory = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!(await this.assertOwnedByAccess(req, res))) return res;
      const history = await this.service.getHistory(req.params.id as string);
      return res.json(history);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new PdvSalesRequestController();
