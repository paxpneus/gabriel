import { Request, Response } from "express";
import multer from "multer";
import RouterController from "../../../../../../../shared/utils/base-models/base-router-controller";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import { BlingApiFetchQueue } from "../../../../../../handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { TCarUpsertQueue } from "../../../../../../handlers/tecinco/queues/tecinco-api-fetch.queue";
import invoiceIngestionService from "../services/ingestion.service";

const upload = multer({ storage: multer.memoryStorage() });

// Montado pelo invoice.routes.ts (o loader só lê invoice.routes.ts): rota de import manual de XML.
export class IngestionController extends RouterController {
  constructor() {
    super();

    this.router.post(
      "/import/xml",
      upload.single("xml"),
      ...this.mw("importXML"),
      this.importXML,
    );
  }

  protected middlewaresFor() {
    return {
      importXML: [authenticate, userPermissions],
    };
  }

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

      await invoiceIngestionService.importInvoiceXml({
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
}

export default new IngestionController();
