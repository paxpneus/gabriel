import { Request, Response } from "express";
import multer from "multer";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import PdvSalesRequest from "./pdv-sales-request.model";
import pdvSalesRequestService, {
  PdvSalesRequestService,
} from "./pdv-sales-request.service";
import { PdvShippingType } from "./pdv-sales-request.types";
import { TCarUpsertQueue } from "../../../handlers/tecinco/queues/tecinco-api-fetch.queue";

const upload = multer({ storage: multer.memoryStorage() });

// Sem authenticate/userPermissions de propósito — este módulo não usa o
// RBAC normal de usuário logado; controle de acesso é inteiramente via
// token de link, na Etapa 2 (ainda não implementada). Até lá estas rotas
// ficam sem proteção alguma — pendência bloqueante antes de produção, não
// esquecimento.
export class PdvSalesRequestController extends BaseController<
  PdvSalesRequest,
  PdvSalesRequestService
> {
  constructor() {
    super(pdvSalesRequestService);

    this.router.post(
      "/:id/receipt",
      upload.single("receipt"),
      this.attachReceipt,
    );
    this.router.post("/:id/finance/approve", this.financeApprove);
    this.router.post("/:id/finance/reject", this.financeReject);
    this.router.post("/:id/cd21-analysis/approve", this.cd21AnalysisApprove);
    this.router.post("/:id/cd21-analysis/reject", this.cd21AnalysisReject);
    this.router.post("/:id/correction/resolve", this.resolveCorrection);
    this.router.post("/:id/sale-invoice/ready", this.markSaleInvoiceReady);
    this.router.get(
      "/transfer-invoice/search",
      this.searchTransferInvoiceCandidates,
    );
    this.router.post(
      "/:id/transfer-invoice",
      upload.fields([
        { name: "xml", maxCount: 1 },
        { name: "danfe", maxCount: 1 },
      ]),
      this.attachTransferInvoice,
    );
    this.router.post("/:id/expedition/reject", this.expeditionReject);
    this.router.post("/:id/finish", this.finish);
    this.router.get("/:id/history", this.getHistory);
  }

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { orderId, name, createdByUserId } = req.body;
      const created = await this.service.createRequest({
        orderId,
        name,
        createdByUserId,
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

  destroy = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({
      error:
        "Exclusão não é permitida — resolva pelo fluxo de correção/cancelamento.",
    });
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

  attachReceipt = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Comprovante obrigatório" });
      }
      const { shippingType, userId } = req.body;
      const updated = await this.service.attachReceiptAndShippingType(
        req.params.id as string,
        {
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          shippingType: shippingType as PdvShippingType,
          userId,
        },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  financeApprove = async (req: Request, res: Response): Promise<Response> => {
    try {
      const updated = await this.service.financeApprove(
        req.params.id as string,
        req.body.userId,
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  financeReject = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { note, userId } = req.body;
      const updated = await this.service.financeReject(
        req.params.id as string,
        { note, userId },
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
        req.body.userId,
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
      const { reasons, note, userId } = req.body;
      const updated = await this.service.cd21AnalysisReject(
        req.params.id as string,
        { reasons, note, userId },
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
      const { userId, decision } = req.body;
      const updated = await this.service.resolveCorrection(
        req.params.id as string,
        { userId, decision },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  markSaleInvoiceReady = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const updated = await this.service.markSaleInvoiceReady(
        req.params.id as string,
        req.body.userId,
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
      const { invoiceId, userId } = req.body;

      const updated = await this.service.attachTransferInvoice(
        req.params.id as string,
        {
          invoiceId,
          xmlBuffer: xmlFile?.buffer,
          danfeBuffer: danfeFile?.buffer,
          danfeMimeType: danfeFile?.mimetype,
          tcarUpsertQueue: req.app.locals.TCarUpsertQueue as TCarUpsertQueue,
          userId,
        },
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  expeditionReject = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { reasons, note, userId } = req.body;
      const updated = await this.service.expeditionReject(
        req.params.id as string,
        { reasons, note, userId },
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
        req.body.userId,
      );
      return res.json(updated);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getHistory = async (req: Request, res: Response): Promise<Response> => {
    try {
      const history = await this.service.getHistory(req.params.id as string);
      return res.json(history);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new PdvSalesRequestController();
