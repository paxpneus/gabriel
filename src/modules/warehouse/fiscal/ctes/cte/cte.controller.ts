import CteService from "./services/cte.service";
import cteXmlService, { CteXmlService } from "./services/cte-xml.service";
import BaseController from "../../../../../shared/utils/base-models/base-controller";
import Cte from "./cte.model";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import { authenticate } from "../../../../../middlewares/auth-token";
import { Request, Response } from "express";
import archiver from "archiver";
import { randomUUID } from "crypto";
import cteXmlBatchQueue from './queues/cte-download.queue'
import { JobTracker } from './helpers/cte-download.tracker';
import uploaderService from "../../../../handlers/uploader/services/uploader.service";

const SYNC_THRESHOLD = 5;

export class CteController extends BaseController<Cte, typeof CteService> {
  constructor(private xmlService: CteXmlService = cteXmlService) {
    super(CteService);

    this.router.post("/xml/batch", ...this.mw("downloadXmlBatch"), this.downloadXmlBatch);
    this.router.get("/xml/batch/:jobId/status", ...this.mw("downloadXmlBatch"), this.getXmlBatchStatus);
    this.router.get("/xml/batch/:jobId/download", ...this.mw("downloadXmlBatch"), this.downloadXmlBatchFile);
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
      const { cteIds, filters, search } = req.body as {
        cteIds?: string[];
        filters?: Record<string, any>;
        search?: string;
      };

      let ids: string[];

      if (cteIds?.length) {
        ids = cteIds;
      } else if (filters || search) {
        ids = await CteService.findAllIds({ filters, search });
      } else {
        res.status(400).json({ error: "Nenhum ID ou filtro informado" });
        return;
      }

      if (!ids.length) {
        res.status(400).json({ error: "Nenhum CT-e encontrado para os critérios informados." });
        return;
      }

      // ─── Até o threshold: mantém o fluxo síncrono atual ───────────────
      if (ids.length <= SYNC_THRESHOLD) {
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="xmls-${Date.now()}.zip"`);

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
        return;
      }

      // ─── Acima do threshold: processa em background ───────────────────
      const jobId = randomUUID();
      const userId = (req as any).user.id;

      await JobTracker.init(jobId, ids.length);
      await cteXmlBatchQueue.add({ jobId, userId, ids }, jobId);

      res.status(202).json({ jobId, total: ids.length, async: true });
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  };

  getXmlBatchStatus = async (req: Request, res: Response): Promise<void> => {
    const state = await JobTracker.get(req.params.jobId as string);
    if (!state) {
      res.status(404).json({ error: "Job não encontrado ou expirado." });
      return;
    }
    res.json(state);
  };

  // Faz o proxy do arquivo (nuvem pax -> cliente) e deleta em seguida.
  downloadXmlBatchFile = async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.params;
    const state = await JobTracker.get(jobId as string);

    if (!state || state.status !== "done" || !state.filePath) {
      res.status(404).json({ error: "Arquivo ainda não está pronto." });
      return;
    }

    try {
      const buffer = await uploaderService.getFile(state.filePath);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="xmls-${jobId}.zip"`);
      res.send(buffer);

      // limpeza: sucesso na entrega -> apaga da nuvem e do tracker
      await uploaderService.delete(state.filePath);
      await JobTracker.update(jobId as string, { status: "done", filePath: undefined });
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: "Falha ao recuperar o arquivo." });
      console.error(`[XML BATCH] Erro ao baixar/limpar job=${jobId}:`, err);
    }
  };
}

export default new CteController();