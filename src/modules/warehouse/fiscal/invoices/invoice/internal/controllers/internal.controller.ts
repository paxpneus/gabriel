import { Request, Response } from "express";
import RouterController from "../../../../../../../shared/utils/base-models/base-router-controller";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import internalInvoiceService from "../services/internal.service";
import { resolveUnitBusinessId } from "../../shared";
import { getUserContext } from "../../../../../../../shared/query/get-logged-user";
import User from "../../../../../../company/users/users/user.model";
import UnitBusiness from "../../../../../../company/unit-business/unit-business.model";

// Rotas da nota interna (série B Tecinco); montado pelo invoice.routes.ts antes do core.
class InternalController extends RouterController {
  constructor() {
    super();

    this.router.get("/internal/list", ...this.mw("listInternalInvoices"), this.listInternalInvoices);
    this.router.post("/internal/batch/generate", ...this.mw("generateInternalBatch"), this.generateInternalBatch);
    this.router.post("/internal/batch/scan/outgoing", ...this.mw("scanInternalBatch"), this.scanInternalBatch("OUTGOING"));
    this.router.post("/internal/batch/scan/incoming", ...this.mw("scanInternalBatch"), this.scanInternalBatch("INCOMING"));
    this.router.post("/internal/batch/adjust/:direction", ...this.mw("adjustInternalBatch"), this.adjustInternalBatch);
    this.router.get("/internal/batch/pending/:batchItemId", ...this.mw("findInternalBatchPending"), this.findInternalBatchPending);
    this.router.post("/internal/batch/:batchId/finish", ...this.mw("finishInternalBatch"), this.finishInternalBatch);
  }

  protected middlewaresFor() {
    return {
      listInternalInvoices: [authenticate, userPermissions],
      generateInternalBatch: [authenticate, userPermissions],
      scanInternalBatch: [authenticate, userPermissions],
      adjustInternalBatch: [authenticate, userPermissions],
      findInternalBatchPending: [authenticate, userPermissions],
      finishInternalBatch: [authenticate, userPermissions],
    };
  }

  // Body { invoiceIds, type, mode }; loja do request ou a do usuário logado (igual ao generate-from-invoices).
  generateInternalBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { invoiceIds, type, mode } = req.body;
      if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res.status(400).json({ error: "Informe ao menos uma nota interna" });
      }
      const context = await getUserContext(req);
      const unitBusinessId = req.body.unitBusinessId ?? resolveUnitBusinessId(req, context.unitBusinessId);
      const batch = await internalInvoiceService.generateInternalBatch(invoiceIds, unitBusinessId, type, mode);
      return res.status(201).json(batch);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  // Body { productcode, batchId, quantity }: bipagem por EAN, mesma resposta do scan atual.
  scanInternalBatch = (type: "OUTGOING" | "INCOMING") => async (req: Request, res: Response): Promise<Response> => {
    try {
      const { productcode, batchId, quantity } = req.body;
      const { userId } = await getUserContext(req);
      await internalInvoiceService.scanInternalBatchProduct({ productCode: productcode, batchId, quantity, userId, type });
      return res.status(201).json({ message: "Produto escaneado com sucesso" });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Body { batchId, invoiceId, productId, quantity (com sinal) }; :direction = outgoing | incoming; admin/developer (checado no service).
  adjustInternalBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const direction = req.params.direction;
      if (direction !== "outgoing" && direction !== "incoming") {
        return res.status(400).json({ error: "Direção inválida (outgoing ou incoming)" });
      }
      const { batchId, invoiceId, productId, quantity } = req.body;
      const { userId } = await getUserContext(req);
      await internalInvoiceService.adjustInternalBatchQuantity({
        batchId,
        invoiceId,
        productId,
        quantity,
        userId,
        type: direction === "outgoing" ? "OUTGOING" : "INCOMING",
      });
      return res.json({ message: "Quantidade atualizada com sucesso" });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  findInternalBatchPending = async (req: Request, res: Response): Promise<Response> => {
    try {
      const data = await internalInvoiceService.findInternalBatchPending(req.params.batchItemId as string);
      return res.json({ data });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  // Body { justification }; usuário com a loja carregado igual ao finishBatch atual (a conferência Tecinco usa).
  finishInternalBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const context = await getUserContext(req);
      const user = await User.findByPk(context.userId, {
        include: [{ model: UnitBusiness, as: "unitBusiness" }],
      });
      await internalInvoiceService.finishInternalBatch(req.params.batchId as string, req.body.justification, user);
      return res.json("Lote finalizado com sucesso!");
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Sempre escopado na loja do usuário logado (notas que ela emitiu ou recebeu), ignora unitBusinessId do request.
  listInternalInvoices = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const { unitBusinessId } = await getUserContext(req);
      const result = await internalInvoiceService.listInternalInvoices(params, unitBusinessId);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new InternalController();
