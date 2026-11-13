import { Request, Response } from "express";
import BaseController, { StoreNumberField } from "../../../../shared/utils/base-models/base-controller";
import ExpeditionBatch from "./batch.model";
import ExpeditionBatchService from "./batch.service";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import User from "../../../company/users/users/user.model";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import { getRequestUserId, getUserContext } from "../../../../shared/query/get-logged-user";
import { CORRECTION_LETTER_JUSTIFICATIONS, PdvBatchActionParams } from "./batch.types";
import { assertUuid } from "../../../../shared/utils/validators/uuid";
import { transferLinkActorFromRequest } from "../../fiscal/invoices/invoice";
import {
  authenticateOrPdvLink,
  pdvAccess,
  PdvAccessRequest,
  pdvLoginAccess,
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

  // ?store_number= de application filtra o index por unit_business_id.
  protected storeNumberField(): StoreNumberField {
    return "unit_business_id";
  }

  // GET /expedition-batches: lote interno (filters[is_internal]=true) só da loja do usuário logado (emitiu ou recebeu); application segue sem escopo.
  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      let forcedWhere = await this.storeNumberWhere(req);
      if (String(params.filters?.is_internal) === "true" && getRequestUserId(req)) {
        const { unitBusinessId } = await getUserContext(req);
        forcedWhere = { ...forcedWhere, unit_business_id: unitBusinessId };
      }
      return res.json(await this.service.paginate(params, undefined, forcedWhere));
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

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
      generateBatchFromQrCode: [authenticate, userPermissions],
      enqueueBlingReconciliationCheck: [authenticate, userPermissions],
      getBlingReconciliationCheckStatus: [authenticate, userPermissions],
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
      findAuditLogs: [authenticate, userPermissions],
      // Lista fixa, sem dado sensível: só login, pra servir a tela normal e a do CD21 (PDV).
      listCorrectionLetterJustifications: [authenticate],
      addInvoiceToLastOutgoingBatch: [authenticate],
      generateBatchFromPdv: [pdvLoginAccess([PdvAccessScreen.CD21])],
      addPdvToBatch: [pdvLoginAccess([PdvAccessScreen.CD21])],
      generateDeliveryNoteFromPdv: [pdvLoginAccess([PdvAccessScreen.CD21])],
      findPdvPendingBatches: [pdvAccess([PdvAccessScreen.CD21])],
      getPdvSalesRequestBatchStatus: [pdvAccess([PdvAccessScreen.CD21])],
      // CRUD bulk do BaseController: sem chave aqui a rota ficava sem nenhum middleware.
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }

  private registerCustomRoutes(): void {
    // POST /expedition-batches/generate-from-invoices
    this.router.post(
      "/generate-from-invoices",
      ...this.mw("generateBatchesFromInvoices"),
      (req, res) => this.generateBatchesFromInvoices(req, res),
    );

    // QR do romaneio: id do lote de expedição de outra loja → lote desta loja com as mesmas notas.
    this.router.post(
      "/from-qr-code",
      ...this.mw("generateBatchFromQrCode"),
      this.generateBatchFromQrCode,
    );

    // Lote de entrada com nota Bling: 1ª etapa (avaliação na Bling por job) + polling do status; o jobId vai no gerar lote.
    this.router.post(
      "/bling-reconciliation-check",
      ...this.mw("enqueueBlingReconciliationCheck"),
      this.enqueueBlingReconciliationCheck,
    );
    this.router.get(
      "/bling-reconciliation-check/:jobId",
      ...this.mw("getBlingReconciliationCheckStatus"),
      this.getBlingReconciliationCheckStatus,
    );

    // Tela CD21 do PDV, só login: 3 ações por coluna (+ transportadora/ids opcionais), ver pdvBatchParams.
    this.router.post(
      "/pdv-sales-requests/generate",
      ...this.mw("generateBatchFromPdv"),
      this.generateBatchFromPdv,
    );
    this.router.post(
      "/pdv-sales-requests/add",
      ...this.mw("addPdvToBatch"),
      this.addPdvToBatch,
    );
    this.router.post(
      "/pdv-sales-requests/delivery-note",
      ...this.mw("generateDeliveryNoteFromPdv"),
      this.generateDeliveryNoteFromPdv,
    );
    // Opções de batch_id pro /pdv-sales-requests/add.
    this.router.get(
      "/pdv-sales-requests/pending-batches",
      ...this.mw("findPdvPendingBatches"),
      this.findPdvPendingBatches,
    );
    this.router.get(
      "/in-batch/pdv-sales-request/:salesRequestId",
      ...this.mw("getPdvSalesRequestBatchStatus"),
      this.getPdvSalesRequestBatchStatus,
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

    // Justificativas prontas da carta de correção, pro front oferecer ao gerar o romaneio (2 segmentos: "/:id" da base vem antes).
    this.router.get(
      "/correction-letter/justifications",
      ...this.mw("listCorrectionLetterJustifications"),
      this.listCorrectionLetterJustifications,
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

    this.router.get("/:id/audit-logs", ...this.mw("findAuditLogs"), this.findAuditLogs);
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
      const { invoiceIds, unitBusinessId, type, mode, blingCheckJobId } = req.body;
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
        blingCheckJobId,
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

  // POST /bling-reconciliation-check — body { invoiceIds } (gerar lote) ou { invoiceKey } (add-invoice); 202 com jobId, 200 sem nota Bling, 409 sincronizando.
  enqueueBlingReconciliationCheck = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { invoiceIds, invoiceKey } = req.body ?? {};
      let invoiceKeys: string[] = [];
      if (Array.isArray(invoiceKey)) invoiceKeys = invoiceKey;
      else if (invoiceKey) invoiceKeys = [invoiceKey];

      // Loja = body ou a do usuário logado (como no add-invoice); só a entrada do CD21 avalia.
      const unitBusinessId = req.body?.unitBusinessId ?? (await getUserContext(req)).unitBusinessId;

      const result = await this.service.enqueueBlingReconciliationCheck({
        invoiceIds: Array.isArray(invoiceIds) ? invoiceIds : undefined,
        invoiceKeys,
        unitBusinessId,
      });
      // Reprocesso da nota ainda rodando: 409 pro front avisar que espere a sincronização Bling x Hub.
      if (result.syncing) return res.status(409).json({ error: result.message, syncing: true });
      return res.status(result.jobId ? 202 : 200).json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // GET /bling-reconciliation-check/:jobId — status do job de avaliação (polling do front).
  getBlingReconciliationCheckStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      const result = await this.service.getBlingReconciliationCheckStatus(req.params.jobId as string);
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Loja = a do usuário logado; type opcional (tela de entrada/expedição) — sem ele o service resolve pela loja em cada nota.
  generateBatchFromQrCode = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { batchId, type, mode, blingCheckJobId } = req.body ?? {};
      if (type !== undefined && type !== "INCOMING" && type !== "OUTGOING") {
        return res.status(400).json({ error: "Tipo de lote inválido. Use entrada ou expedição." });
      }
      const { unitBusinessId } = await getUserContext(req);
      if (!unitBusinessId) {
        return res.status(400).json({ error: "Loja do usuário não encontrada." });
      }

      const batch = await this.service.generateBatchFromQrCode(
        assertUuid(batchId, "QR do romaneio"),
        unitBusinessId,
        type,
        mode,
        blingCheckJobId,
      );
      return res.status(201).json(batch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  addInvoiceToBatch = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { invoiceKey, unitBusinessId, type, batchId, transfer_invoice_id, blingCheckJobId } = req.body;

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
        transfer_invoice_id,
        undefined,
        blingCheckJobId,
        { transferLinkActor: transferLinkActorFromRequest(req) },
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
    const { type, transfer_invoice_id } = req.body;
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
      transfer_invoice_id,
      transferLinkActorFromRequest(req),
    );

    return res.json(batch);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

  // status (SHIPPING → cd 12/17, SHIP_TODAY → transporter_id) + sales_request_ids opcional; body no POST, query no GET.
  private pdvBatchParams(req: Request): PdvBatchActionParams {
    const source = { ...req.query, ...(req.body ?? {}) } as Record<string, any>;
    const rawIds = source.sales_request_ids;
    if (rawIds !== undefined && rawIds !== null && !Array.isArray(rawIds)) {
      throw new Error("sales_request_ids deve ser uma lista");
    }

    return {
      status: String(source.status ?? ""),
      // Aceita "12", "CD 12" — só os dígitos importam.
      cd: String(source.cd ?? "").replace(/\D/g, "") || undefined,
      transporterId: source.transporter_id ? String(source.transporter_id) : undefined,
      salesRequestIds: rawIds?.map(String).filter(Boolean),
    };
  }

  generateBatchFromPdv = async (req: Request, res: Response): Promise<Response> => {
    try {
      const result = await this.service.generateBatchFromPdv(this.pdvBatchParams(req));
      return res.status(201).json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  addPdvToBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const batchId = req.body?.batch_id;
      if (batchId !== undefined && batchId !== null && typeof batchId !== "string") {
        return res.status(400).json({ error: "batch_id inválido" });
      }

      const result = await this.service.addPdvToBatch({
        ...this.pdvBatchParams(req),
        batchId: batchId || undefined,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  generateDeliveryNoteFromPdv = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      // Operador do romaneio obrigatório, como no userId da rota padrão (/delivery-note/get).
      const operatorId = req.body?.operator_id;
      if (!operatorId || typeof operatorId !== "string") {
        return res.status(400).json({ error: "Informe o operador do romaneio." });
      }

      // Rota só de login: quem gerou (audit) é o usuário logado. Justificativa: lote com nota com carta de correção.
      const justification = req.body?.correction_letter_justification;
      const result = await this.service.generateDeliveryNoteFromPdv(
        this.pdvBatchParams(req),
        operatorId,
        (req as PdvAccessRequest).pdvAccess!.userId!,
        typeof justification === "string" ? justification : null,
      );
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  findPdvPendingBatches = async (req: Request, res: Response): Promise<Response> => {
    try {
      const batches = await this.service.findPdvPendingBatches(this.pdvBatchParams(req));
      return res.json(batches);
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
      const { batchId, userId, correctionLetterJustification } = req.query;

      // userId da query = operador escolhido; quem gerou (audit) é o usuário logado.
      // correctionLetterJustification: obrigatória se o lote tem nota com carta de correção (texto livre ou preset preenchido pelo front).
      const fullBatch = await this.service.generateDeliveryNote(
        batchId as string,
        userId as string,
        getRequestUserId(req),
        typeof correctionLetterJustification === "string" ? correctionLetterJustification : null,
      );

      return res.json(fullBatch);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Justificativas prontas da carta de correção; o front troca "{notas}" e manda como texto no romaneio.
  listCorrectionLetterJustifications = async (_req: Request, res: Response): Promise<Response> => {
    return res.json(CORRECTION_LETTER_JUSTIFICATIONS);
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

  // GET /:id/audit-logs — histórico de auditoria do lote (404 se não existe), paginado (page/perPage/filters[action]).
  findAuditLogs = async (req: Request, res: Response): Promise<Response> => {
    try {
      const result = await this.service.findAuditLogs(
        assertUuid(req.params.id, "Lote"),
        this.extractQueryParams(req),
      );
      return res.json(result);
    } catch (error: any) {
      if (error.message === "Lote não encontrado") return res.status(404).json({ error: error.message });
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new ExpeditionBatchController();
