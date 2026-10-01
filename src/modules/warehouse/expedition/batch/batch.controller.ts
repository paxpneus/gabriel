import { Request, Response } from "express";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import ExpeditionBatch from "./batch.model";
import ExpeditionBatchService from "./batch.service";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import User from "../../../company/users/users/user.model";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import { getUserContext } from "../../../../shared/query/get-logged-user";
import {
  authenticateOrPdvLink,
  pdvAccess,
  PdvAccessRequest,
} from "../../../sales/pdv-management/pdv-access/pdv-access.middleware";
import { PdvAccessScreen } from "../../../sales/pdv-management/pdv-access/pdv-access.types";

export class ExpeditionBatchController extends BaseController<
  ExpeditionBatch,
  typeof ExpeditionBatchService
> {
  constructor() {
    super(ExpeditionBatchService);
    this.registerCustomRoutes();
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      searchPendingOutgoing: authenticateOrPdvLink(
        [PdvAccessScreen.CD21],
        [authenticate, userPermissions],
      ),
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      generateBatchesFromInvoices: [authenticate, userPermissions],
      getBatchesByInvoice: [authenticate, userPermissions],
      getBatches: [authenticate, userPermissions],
      getFullBatch: [authenticate, userPermissions],
      addInvoiceToBatch: [authenticate, userPermissions],
      finishBatch: [authenticate, userPermissions],
      getMultiplierScan: [authenticate, userPermissions],
      generateDeliveryNote: [authenticate, userPermissions],
      downloadDeliveryNotes: [authenticate, userPermissions],
      isComplete: [authenticate, userPermissions],
      batchReport: [authenticate, userPermissions],
      addInvoiceToLastOutgoingBatch: [authenticate],
      generateBatchFromPdvSalesRequest: [pdvAccess([PdvAccessScreen.CD21])],
      generateDeliveryNoteFromPdvSalesRequest: [
        pdvAccess([PdvAccessScreen.CD21]),
      ],
      addPdvSalesRequestToPendingBatch: [pdvAccess([PdvAccessScreen.CD21])],
      getPdvSalesRequestBatchStatus: [pdvAccess([PdvAccessScreen.CD21])],
      addPdvSalesRequestToBatch: [pdvAccess([PdvAccessScreen.CD21])],
    };
  }

  private registerCustomRoutes(): void {
    // POST /expedition-batches/generate-from-invoices
    this.router.post(
      "/generate-from-invoices",
      ...this.mw("generateBatchesFromInvoices"),
      (req, res) => this.generateBatchesFromInvoices(req, res),
    );

    // Acesso pela tela CD21 do PDV (link ou login), mesmo auth das rotas de
    // /pdv-sales-requests — a solicitação resolve a nota de venda.
    this.router.post(
      "/generate-from-pdv-sales-request/:salesRequestId",
      ...this.mw("generateBatchFromPdvSalesRequest"),
      this.generateBatchFromPdvSalesRequest,
    );
    this.router.get(
      "/delivery-note/pdv-sales-request/:salesRequestId",
      ...this.mw("generateDeliveryNoteFromPdvSalesRequest"),
      this.generateDeliveryNoteFromPdvSalesRequest,
    );
    this.router.post(
      "/add-pdv-sales-request-to-pending/:salesRequestId",
      ...this.mw("addPdvSalesRequestToPendingBatch"),
      this.addPdvSalesRequestToPendingBatch,
    );

    this.router.get(
      "/in-batch/pdv-sales-request/:salesRequestId",
      ...this.mw("getPdvSalesRequestBatchStatus"),
      this.getPdvSalesRequestBatchStatus,
    );

    this.router.post(
      "/add-pdv-sales-request-to-batch/:salesRequestId",
      ...this.mw("addPdvSalesRequestToBatch"),
      this.addPdvSalesRequestToBatch,
    );

    this.router.get("/outgoing-pending/search", ...this.mw("searchPendingOutgoing"), this.searchPendingOutgoing)

    this.router.get(
      "/by-invoices/get",
      ...this.mw("getBatchesByInvoice"),
      this.getBatchesByInvoice,
    );
    this.router.get("/by-ids/get", ...this.mw("getBatches"), this.getBatches);

    this.router.get("/full/get", ...this.mw("getFullBatch"), this.getFullBatch);

    this.router.get(
      "/delivery-note/get",
      ...this.mw("generateDeliveryNote"),
      this.generateDeliveryNote,
    );

    this.router.get(
      "/delivery-notes/get",
      ...this.mw("downloadDeliveryNotes"),
      this.downloadDeliveryNotes,
    );

    this.router.post(
      "/add-invoice",
      ...this.mw("addInvoiceToBatch"),
      (req, res) => this.addInvoiceToBatch(req, res),
    );

     this.router.post(
      "/add-invoice-to-last-outgoing-batch",
      ...this.mw("addInvoiceToLastOutgoingBatch"),
      (req, res) => this.addInvoiceToLastOutgoingBatch(req, res),
    );

    this.router.put("/finish/:batchId", ...this.mw("finishBatch"), (req, res) =>
      this.finishBatch(req, res),
    );

    this.router.get(
      "/is-complete/:batchId",
      ...this.mw("isComplete"),
      (req, res) => this.isComplete(req, res),
    );

    this.router.get(
      "/multiplier-scan-entrance/get",
      ...this.mw("getMultiplierScan"),
      (req, res) => this.getMultiplierScan(req, res),
    );

    this.router.get("/report/get", ...this.mw("batchReport"), (req, res) => this.batchReport(req, res))
  }

  
   searchPendingOutgoing = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      // Link PDV: loja nunca vem do front, sempre CD21.
      const result = (req as PdvAccessRequest).pdvAccess
        ? await this.service.searchCd21PendingOutgoing(params)
        : await this.service.searchPendingOutgoing(
            params,
            (await getUserContext(req)).unitBusinessId,
          );
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
   }

  /**
   * POST /expedition-batches/generate-from-invoices
   * Body: { invoiceIds: string[] }
   */
  generateBatchesFromInvoices = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { invoiceIds, unitBusinessId, type, mode } = req.body;
      if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res
          .status(400)
          .json({ error: "Informe ao menos uma nota fiscal" });
      }

      const batches = await ExpeditionBatchService.generateBatchFromInvoices(
        invoiceIds,
        unitBusinessId,
        type,
        mode,
      );
      return res.status(201).json(batches);
    } catch (error: any) {
      console.error("ERRO DETALHADO:", JSON.stringify(error, null, 2)); 
      console.error("ERRORS ARRAY:", error?.errors); 
      return res
        .status(500)
        .json({ error: error.message, details: error?.errors });
    }
  };

  addInvoiceToBatch = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { invoiceKey, unitBusinessId, type, batchId, description } = req.body;

      const chaves: string[] = Array.isArray(invoiceKey)
      ? invoiceKey
      : invoiceKey
        ? [invoiceKey]
        : [];


      const unitBusinessResolved = unitBusinessId ? unitBusinessId : (await getUserContext(req)).unitBusinessId

      const batches = await ExpeditionBatchService.addInvoiceToBatch(
        chaves,
        unitBusinessResolved,
        type,
        batchId,
        description
      );
      return res.status(201).json(batches);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  addInvoiceToLastOutgoingBatch = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const { type, description } = req.body;
    const { invoiceKey } = req.body;

    const chaves: string[] = Array.isArray(invoiceKey)
      ? invoiceKey
      : invoiceKey
        ? [invoiceKey]
        : [];

    const { unitBusinessId } = await getUserContext(req);

    if (!unitBusinessId) {
      return res
        .status(400)
        .json({ error: "Unit business do usuário não encontrada" });
    }
    if (!chaves.length || !type) {
      return res
        .status(400)
        .json({ error: "invoiceKey e type são obrigatórios" });
    }

    const batch = await this.service.addInvoiceToLastOutgoingBatch(
      chaves,
      unitBusinessId,
      type,
      description,
    );

    return res.json(batch);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

  generateBatchFromPdvSalesRequest = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const batch = await this.service.generateBatchFromPdvSalesRequest(
        req.params.salesRequestId as string,
      );
      return res.status(201).json(batch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  generateDeliveryNoteFromPdvSalesRequest = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const access = (req as PdvAccessRequest).pdvAccess!;
      // Via LOGIN o operador é sempre o usuário logado; por link, só o body/query.
      const userId =
        access.via === "LOGIN" ? access.userId : (req.query.userId as string);

      const batch = await this.service.generateDeliveryNoteFromPdvSalesRequest(
        req.params.salesRequestId as string,
        userId,
      );
      return res.json(batch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  addPdvSalesRequestToPendingBatch = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const batch = await this.service.addPdvSalesRequestToPendingBatch(
        req.params.salesRequestId as string,
      );
      return res.json(batch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  addPdvSalesRequestToBatch = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const batchId = req.body?.batch_id;
      if (!batchId || typeof batchId !== "string") {
        return res.status(400).json({ error: "batch_id é obrigatório" });
      }

      const batch = await this.service.addPdvSalesRequestToBatch(
        req.params.salesRequestId as string,
        batchId,
      );
      return res.json(batch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getPdvSalesRequestBatchStatus = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const status = await this.service.getPdvSalesRequestBatchStatus(
        req.params.salesRequestId as string,
      );
      return res.json(status);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getBatchesByInvoice = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { unitBusinessId } = await getUserContext(req)
      let ids: string[] = [];

      if (Array.isArray(req.query.invoiceIds)) {
        ids = req.query.invoiceIds as string[];
      } else if (typeof req.query.invoiceIds === "string") {
        ids = req.query.invoiceIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      if (!ids.length) {
        return res.status(400).json({ error: "Nenhum invoiceId informado." });
      }

      const batches = await this.service.getBatchesByInvoiceIds(ids, unitBusinessId);
      return res.json(batches);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  };

  getBatches = async (req: Request, res: Response): Promise<Response> => {
    try {
      let ids: string[] = [];

      if (Array.isArray(req.query.batchesIds)) {
        ids = req.query.batchesIds as string[];
      } else if (typeof req.query.batchesIds === "string") {
        ids = req.query.batchesIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      if (!ids.length) {
        return res.status(400).json({ error: "Nenhum lote informado." });
      }

      const batches = await this.service.getBatches(ids);
      return res.json(batches);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  };

  getFullBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { batchId, number } = req.query;

      const fullBatch = await this.service.findByIdFullBatch(
        (batchId as string) ?? "",
        (number as string) ?? "",
      );

      return res.json(fullBatch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  isComplete = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { batchId } = req.params;
      console.log(batchId);
      const response = await this.service.isComplete(batchId as string);

      return res.json(response);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  generateDeliveryNote = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { batchId, userId } = req.query;

      const fullBatch = await this.service.generateDeliveryNote(
        batchId as string,
        userId as string,
      );

      return res.json(fullBatch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  downloadDeliveryNotes = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { batchIds } = req.query;

      const fullBatch = await this.service.downloadDeliveryNotes(
        batchIds as string[],
      );

      return res.json(fullBatch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  finishBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { batchId } = req.params;
      const { justification } = req.body;
      const context = await getUserContext(req);

      const user = await User.findByPk(context.userId, {
        include: [{ model: UnitBusiness, as: "unitBusiness" }],
      });

      console.log("USER ACHADO", user)

      await this.service.finishBatch(batchId as string, justification, user);

      return res.json("Lote finalizado com sucesso!");
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getMultiplierScan(req: Request, res: Response) {
    return res.json(true);
  }

  batchReport = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {id} = req.query
      const result = await this.service.batchReport(id as string)
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}

export default new ExpeditionBatchController();
