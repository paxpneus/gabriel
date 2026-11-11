import { LabelService } from "./invoice-label.service";
import BaseController from "../../../../../shared/utils/base-models/base-controller";
import Invoice from "./invoice.model";
import InvoiceService from "./invoice.service";
import { Request, Response } from "express";
import { authenticate } from "../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import archiver from "archiver";
import { Op } from "sequelize";
import { InvoiceAttributes } from "./invoice.types";
import multer from "multer";
import { BlingApiFetchQueue } from "../../../../handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { TCarUpsertQueue } from "../../../../handlers/tecinco/queues/tecinco-api-fetch.queue";
import { getRequestUserId, getUserContext } from "../../../../../shared/query/get-logged-user";
import { assertUuid } from "../../../../../shared/utils/validators/uuid";
import {
  authenticateOrPdvLink,
  PdvAccessRequest,
} from "../../../../sales/pdv-management/pdv-access/pdv-access.middleware";
import { PdvAccessScreen } from "../../../../sales/pdv-management/pdv-access/pdv-access.types";

const upload = multer({ storage: multer.memoryStorage() });

export class InvoiceController extends BaseController<
  Invoice,
  typeof InvoiceService
> {
  private labelService: LabelService;

  constructor() {
    super(InvoiceService);

    this.labelService = new LabelService();

    this.router.get(
      "/labels/data",
      ...this.mw("getLabelData"),
      this.getLabelData,
    );
    this.router.get(
      "/danfe/data",
      ...this.mw("getDanfeBatch"),
      this.getDanfeBatch,
    );
    this.router.get(
      "/full/:id",
      ...this.mw("getFullInvoice"),
      this.getFullInvoice,
    );

    this.router.post(
      "/bulk/open",
      ...this.mw("updateInvoicesOpen"),
      this.updateInvoicesOpen,
    );

    this.router.post(
      "/bulk/mark-internal-use",
      ...this.mw("markAsInternalUse"),
      this.markAsInternalUse,
    );

    this.router.post(
      "/:id/finish",
      ...this.mw("finishPendingInvoice"),
      this.finishPendingInvoice,
    );

    // Carta de correção em PDF (campo "file"): libera a nota CD 12/17 sem nota de transferência no lote/romaneio.
    this.router.post(
      "/:id/correction-letter",
      upload.single("file"),
      ...this.mw("attachCorrectionLetter"),
      this.attachCorrectionLetter,
    );

    this.router.get(
      "/:id/correction-letter",
      ...this.mw("getCorrectionLetter"),
      this.getCorrectionLetter,
    );

    this.router.get(
      "/:id/audit-logs",
      ...this.mw("findAuditLogs"),
      this.findAuditLogs,
    );

    this.router.put(
      "/schedule/invoice/:id",
      ...this.mw("scheduleInvoice"),
      this.scheduleInvoice,
    );

    this.router.post(
      "/import/xml",
      upload.single("xml"),
      ...this.mw("importXML"),
      this.importXML,
    );

    this.router.post(
      "/xml/batch",
      ...this.mw("downloadXmlBatch"),
      this.downloadXmlBatch,
    );

    this.router.get(
      "/report/products",
      ...this.mw("getInvoiceProductReport"),
      this.getInvoiceProductReport,
    );

    this.router.get(
      "/report/supplier",
      ...this.mw("getInvoiceSupplierReport"),
      this.getInvoiceSupplierReport,
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

    this.router.get(
      "/report/transfer",
      ...this.mw("getTransferInvoicesReport"),
      this.getTransferInvoicesReport,
    );
  }

  // filters[unit_business_id] também é lido aqui — antes só valia
  // ?unitBusinessId=, e ter os dois convivendo sem se sobrepor causava um
  // AND impossível entre esse escopo e o customField unit_business_id do
  // queryConfig (mesmo campo, valores diferentes = zero resultados).
  private extractUnitBusinessIdFromRequest(req: Request): string | undefined {
    const filtersUnitBusinessId = (
      req.query.filters as Record<string, unknown> | undefined
    )?.unit_business_id;

    const fromParams = (req.params.unitBusinessId ??
      req.query.unitBusinessId ??
      (typeof filtersUnitBusinessId === "string"
        ? filtersUnitBusinessId
        : undefined)) as string | undefined;

    return fromParams && fromParams.trim() ? fromParams : undefined;
  }

  private resolveUnitBusinessId(
    req: Request,
    contextUnitBusinessId: string,
  ): string {
    return this.extractUnitBusinessIdFromRequest(req) ?? contextUnitBusinessId;
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

      getLabelData: [authenticate, userPermissions],
      getDanfeBatch: authenticateOrPdvLink(
        [PdvAccessScreen.CD21, PdvAccessScreen.FINANCE, PdvAccessScreen.STORE_REQUEST],
        [authenticate, userPermissions],
      ),

      updateInvoicesOpen: [authenticate, userPermissions],
      scheduleInvoice: [authenticate, userPermissions],

      importXML: [authenticate, userPermissions],
      downloadXmlBatch: [authenticate, userPermissions],
      getInvoiceProductReport: [authenticate, userPermissions],
      getInvoiceSupplierReport: [authenticate, userPermissions],
      listInvoicesPendingLogisticOccurrence: [authenticate, userPermissions],
      markAsInternalUse: [authenticate, userPermissions],
      finishPendingInvoice: [authenticate, userPermissions],
      attachCorrectionLetter: [authenticate, userPermissions],
      getCorrectionLetter: [authenticate, userPermissions],
      findAuditLogs: [authenticate, userPermissions],
      listTransferInvoices: [authenticate, userPermissions],
      getTransferInvoicesReport: [authenticate, userPermissions],
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
      const unitBusinessId = this.resolveUnitBusinessId(
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
      const unitBusinessId = this.extractUnitBusinessIdFromRequest(req);
      const result = await this.service.listTransferInvoices(
        params,
        unitBusinessId,
      );
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  // Relatório (sem paginação) das notas de transferência — mesmos filtros de
  // `listTransferInvoices`.
  getTransferInvoicesReport = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const unitBusinessId = this.extractUnitBusinessIdFromRequest(req);
      const data = await this.service.getTransferInvoicesReport(
        params,
        unitBusinessId,
      );
      return res.json({ data });
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
      const unitBusinessId = this.resolveUnitBusinessId(
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
      const unitBusinessId = this.resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      await this.service.updateInvoices(
        [req.params.id as string],
        unitBusinessId,
        req.body,
      );
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getFullInvoice = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id } = req.params;
      const context = await getUserContext(req);
      const unitBusinessId = this.resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      // ?type= na loja de transbordo: a nota tem lote de entrada e de expedição ali.
      const { type } = req.query;
      const data = await this.service.findByIdFullWithBatch(
        id as string,
        unitBusinessId,
        type === "INCOMING" || type === "OUTGOING" ? type : undefined,
      );
      return res.json({ data });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  };

  getLabelData = async (req: Request, res: Response): Promise<Response> => {
    try {
      let ids: string[] = [];

      if (Array.isArray(req.query.invoiceIds)) {
        ids = req.query.invoiceIds as string[];
      } else if (typeof req.query.invoiceIds === "string") {
        ids = req.query.invoiceIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const limit = Math.min(
        200,
        Math.max(1, Number(req.query.limit) || 50),
      );

      const context = await getUserContext(req);
      const unitBusinessId = this.resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );

      const { data, nextCursor, totalVolumes } =
        await this.labelService.getLabelDataPage(ids, unitBusinessId, {
          cursor,
          limit,
        });

      return res.json({ data, nextCursor, totalVolumes });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  };

  getDanfeBatch = async (req: Request, res: Response): Promise<void> => {
    try {
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
        res.status(400).json({ error: "Nenhum ID informado" });
        return;
      }

      // Link PDV: só gera o PDF, danfe_printed fica só pra usuário logado.
      const unitBusinessId = (req as PdvAccessRequest).pdvAccess
        ? undefined
        : this.resolveUnitBusinessId(
            req,
            (await getUserContext(req)).unitBusinessId,
          );

      const pdf = await this.service.getDanfeBatch(ids, unitBusinessId);

      if (!pdf) {
        res.status(404).json({ error: "Nenhuma nota encontrada" });
        return;
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="danfes-${Date.now()}.pdf"`,
      );
      res.send(pdf);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  };

  downloadXmlBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = req.body.invoiceIds;

      if (!ids.length) {
        res.status(400).json({ error: "Nenhum ID informado" });
        return;
      }

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="xmls-${Date.now()}.zip"`,
      );

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", (err) => {
        console.error("[XML BATCH] Erro no archiver:", err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
      });
      archive.pipe(res);

      for await (const { filename, xml } of this.service.streamXmlEntries(
        ids,
      )) {
        archive.append(xml, { name: filename });
      }

      await archive.finalize();
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  };

  updateInvoicesOpen = async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = req.body;
      const context = await getUserContext(req);
      const unitBusinessId = this.resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      await this.service.updateInvoicesOpen(ids, unitBusinessId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  markAsInternalUse = async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = req.body;
      const context = await getUserContext(req);
      const unitBusinessId = this.resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      await this.service.markAsInternalUse(ids, unitBusinessId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // Finaliza nota OPEN/PENDING da unit business com observação obrigatória (body: { observation }).
  finishPendingInvoice = async (req: Request, res: Response): Promise<void> => {
    try {
      const { observation } = req.body;
      const { id } = req.params;
      const context = await getUserContext(req);
      const unitBusinessId = this.resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      await this.service.finishPendingInvoice(
        id as string,
        unitBusinessId,
        observation,
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  scheduleInvoice = async (req: Request, res: Response): Promise<void> => {
    try {
      const { expectedDate } = req.body;
      const { id } = req.params;
      const context = await getUserContext(req);
      const unitBusinessId = this.resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      await this.service.scheduleInvoice(
        id as string,
        expectedDate,
        unitBusinessId,
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // POST /:id/correction-letter — 400 com o motivo se o PDF não for a carta de correção desta nota.
  attachCorrectionLetter = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.file) return res.status(400).json({ error: "Envie o PDF da carta de correção." });
      const invoice = await this.service.attachCorrectionLetter(
        assertUuid(req.params.id, "Nota fiscal"),
        { buffer: req.file.buffer, mimeType: req.file.mimetype },
        getRequestUserId(req),
      );
      return res.json(invoice);
    } catch (error: any) {
      if (error.message === "Nota fiscal não encontrada") return res.status(404).json({ error: error.message });
      return res.status(400).json({ error: error.message });
    }
  };

  // GET /:id/correction-letter — PDF da carta (inline, como o DANFE), da nuvem ou do staging; 404 sem nota/carta.
  getCorrectionLetter = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { buffer, filename } = await this.service.getCorrectionLetterFile(assertUuid(req.params.id, "Nota fiscal"));
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `inline; filename="${filename}"`);
      return res.send(buffer);
    } catch (error: any) {
      if (["Nota fiscal não encontrada", "A nota não tem carta de correção anexada."].includes(error.message)) {
        return res.status(404).json({ error: error.message });
      }
      return res.status(400).json({ error: error.message });
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

  importXML = async (req: Request, res: Response): Promise<void> => {
    const { integration } = req.body;
    try {
      if (!req.file) {
        res.status(400).json({ error: "Nenhum arquivo XML enviado" });
        return;
      }

      if (!integration) {
        res.status(400).json({ error: "Nenhuma integração selecionada!" });
        return;
      }
      // Mesmos valores aceitos pelo service — inválido é erro de quem chamou (400), não do servidor.
      if (!["bling", "tecinco"].includes(integration)) {
        res.status(400).json({ error: `Integração inválida: ${integration}` });
        return;
      }

      const xmlContent = req.file.buffer.toString("utf-8");

      if (!xmlContent.trim()) {
        res.status(400).json({ error: "Arquivo XML vazio" });
        return;
      }

      await this.service.importInvoiceXml({
        integration,
        xmlContent,
        userId: (req as any).user?.id,
        blingQueue: req.app.locals.BlingApiFetchQueue as BlingApiFetchQueue,
        tecincoQueue: req.app.locals.TCarUpsertQueue as TCarUpsertQueue,
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getInvoiceProductReport = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const context = await getUserContext(req);
      const unitBusinessId = this.resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      const { rows, summary } = await this.service.getInvoiceProductReport(
        params,
        unitBusinessId,
      );
      // `data` mantido no formato antigo; `summary` (totais da nota + desconto de fornecedor) é adicional.
      return res.json({ data: rows, summary });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  };

  getInvoiceSupplierReport = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const context = await getUserContext(req);
      const unitBusinessId = this.resolveUnitBusinessId(
        req,
        context.unitBusinessId,
      );
      const { rows, summary } = await this.service.getInvoiceSupplierReport(
        params,
        unitBusinessId,
      );
      // `data` mantido no formato antigo; `summary` é adicional.
      return res.json({ data: rows, summary });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  };
}

export default new InvoiceController();
