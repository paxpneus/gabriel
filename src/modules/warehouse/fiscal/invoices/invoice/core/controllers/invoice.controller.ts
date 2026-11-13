import BaseController from "../../../../../../../shared/utils/base-models/base-controller";
import Invoice from "../../invoice.model";
import invoiceService, { InvoiceService } from "../services/invoice.service";
import { Request, Response } from "express";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import { getUserContext } from "../../../../../../../shared/query/get-logged-user";
import { assertUuid } from "../../../../../../../shared/utils/validators/uuid";
import {
  extractUnitBusinessIdFromRequest,
  internalInvoiceScopeService,
  resolveUnitBusinessId,
  transferLinkActorFromRequest,
} from "../../shared";

// CRUD, detalhe completo, listagens e histórico de auditoria da nota fiscal.
export class InvoiceController extends BaseController<
  Invoice,
  InvoiceService
> {
  constructor() {
    super(invoiceService);

    this.router.get(
      "/full/:id",
      ...this.mw("getFullInvoice"),
      this.getFullInvoice,
    );

    this.router.get(
      "/:id/audit-logs",
      ...this.mw("findAuditLogs"),
      this.findAuditLogs,
    );

    this.router.get(
      "/pending-occurrences/get",
      ...this.mw("listInvoicesPendingLogisticOccurrence"),
      this.listInvoicesPendingLogisticOccurrence,
    );

    this.router.get(
      "/transfer/list",
      ...this.mw("listTransferInvoices"),
      this.listTransferInvoices,
    );
  }

  protected registerCustomRoutes(): void {}

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],

      getFullInvoice: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      login: [authenticate, userPermissions],

      listInvoicesPendingLogisticOccurrence: [authenticate, userPermissions],
      findAuditLogs: [authenticate, userPermissions],
      listTransferInvoices: [authenticate, userPermissions],
      // CRUD bulk do BaseController: sem chave aqui a rota ficava sem nenhum middleware.
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      const result = await this.service.listInvoices(params, unitBusinessId);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  // Notas de transferência (remetente E destinatário são ambas unit
  // businesses próprias) — igual a `index`, mas sem cair no unit_business_id
  // do contexto logado quando o front não manda nenhum: sem filtro, lista
  // transferências de todas as unit businesses.
  listTransferInvoices = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const unitBusinessId = extractUnitBusinessIdFromRequest(req);
      const result = await this.service.listTransferInvoices(
        params,
        unitBusinessId,
      );
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  listInvoicesPendingLogisticOccurrence = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const result = await this.service.listInvoicesPendingLogisticOccurrence();
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      const record = await this.service.findByIdWithViewPoint(
        req.params.id as string,
        unitBusinessId,
      );
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    try {
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      // PUT /:id: nota interna só pelos fluxos de internal/ (updateInvoices em si segue aberto pro lote/scan internos).
      await internalInvoiceScopeService.assertNotInternalInvoices({ id: req.params.id as string });
      await this.service.updateInvoices(
        [req.params.id as string],
        unitBusinessId,
        req.body,
        undefined,
        undefined,
        transferLinkActorFromRequest(req),
      );
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // PUT /bulk: mesmo do BaseController, repassando quem alterou (auditoria/admin do vínculo de transferência).
  bulkUpdate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const records = await this.service.bulkUpdate(req.body, { where: { id: req.body.ids } }, transferLinkActorFromRequest(req));
      return res.status(201).json(records);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getFullInvoice = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id } = req.params;
      const context = await getUserContext(req);
      const unitBusinessId = resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      // ?type= na loja de transbordo: a nota tem lote de entrada e de expedição ali.
      const { type } = req.query;
      const data = await this.service.findByIdFullWithBatch(
        id as string,
        unitBusinessId,
        type === "INCOMING" || type === "OUTGOING" ? type : undefined,
        transferLinkActorFromRequest(req).roleId,
      );
      return res.json({ data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  };

  // GET /:id/audit-logs — histórico de auditoria da nota (404 se não existe), paginado (page/perPage/filters[action]).
  findAuditLogs = async (req: Request, res: Response): Promise<Response> => {
    try {
      const result = await this.service.findAuditLogs(
        assertUuid(req.params.id, "Nota fiscal"),
        this.extractQueryParams(req),
      );
      return res.json(result);
    } catch (error: any) {
      if (error.message === "Nota fiscal não encontrada") return res.status(404).json({ error: error.message });
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new InvoiceController();
