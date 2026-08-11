import CteService from "./services/cte.service";
import cteXmlService, { CteXmlService } from "./services/cte-xml.service";
import BaseController from "../../../../../shared/utils/base-models/base-controller";
import Cte from "./cte.model";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import { authenticate } from "../../../../../middlewares/auth-token";
import { Request, Response } from "express";
import archiver from "archiver";

export class CteController extends BaseController<Cte, typeof CteService> {
  constructor(private xmlService: CteXmlService = cteXmlService) {
    super(CteService);

    this.router.post(
      "/xml/batch",
      ...this.mw("downloadXmlBatch"),
      this.downloadXmlBatch,
    );
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      downloadXmlBatch: [authenticate, userPermissions],
    };
  }

  downloadXmlBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = req.body.cteIds;

      if (!ids?.length) {
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

      for await (const { filename, xml } of this.xmlService.streamXmlEntries(ids)) {
        archive.append(xml, { name: filename });
      }

      await archive.finalize();
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  };
}

export default new CteController();