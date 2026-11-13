import { Request, Response } from "express";
import archiver from "archiver";
import multer from "multer";
import RouterController from "../../../../../../../shared/utils/base-models/base-router-controller";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import { getRequestUserId, getUserContext } from "../../../../../../../shared/query/get-logged-user";
import { assertUuid } from "../../../../../../../shared/utils/validators/uuid";
import {
  authenticateOrPdvLink,
  PdvAccessRequest,
} from "../../../../../../sales/pdv-management/pdv-access/pdv-access.middleware";
import { PdvAccessScreen } from "../../../../../../sales/pdv-management/pdv-access/pdv-access.types";
import invoiceDocumentsService from "../services/documents.service";
import { resolveUnitBusinessId } from "../../shared";

const upload = multer({ storage: multer.memoryStorage() });

// Rotas de documentos da nota (DANFE, XML em lote, carta de correção) em /api/invoices.
class DocumentsController extends RouterController {
  constructor() {
    super();

    this.router.get(
      "/danfe/data",
      ...this.mw("getDanfeBatch"),
      this.getDanfeBatch,
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

    this.router.post(
      "/xml/batch",
      ...this.mw("downloadXmlBatch"),
      this.downloadXmlBatch,
    );
  }

  protected middlewaresFor() {
    return {
      getDanfeBatch: authenticateOrPdvLink(
        [PdvAccessScreen.CD21, PdvAccessScreen.FINANCE, PdvAccessScreen.STORE_REQUEST],
        [authenticate, userPermissions],
      ),
      downloadXmlBatch: [authenticate, userPermissions],
      attachCorrectionLetter: [authenticate, userPermissions],
      getCorrectionLetter: [authenticate, userPermissions],
    };
  }

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
        : resolveUnitBusinessId(
            req,
            (await getUserContext(req)).unitBusinessId,
          );

      const pdf = await invoiceDocumentsService.getDanfeBatch(ids, unitBusinessId);

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

      for await (const { filename, xml } of invoiceDocumentsService.streamXmlEntries(
        ids,
      )) {
        archive.append(xml, { name: filename });
      }

      await archive.finalize();
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  };

  // POST /:id/correction-letter — 400 com o motivo se o PDF não for a carta de correção desta nota.
  attachCorrectionLetter = async (req: Request, res: Response): Promise<Response> => {
    try {
      if (!req.file) return res.status(400).json({ error: "Envie o PDF da carta de correção." });
      const invoice = await invoiceDocumentsService.attachCorrectionLetter(
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
      const { buffer, filename } = await invoiceDocumentsService.getCorrectionLetterFile(assertUuid(req.params.id, "Nota fiscal"));
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
}

export default new DocumentsController();
