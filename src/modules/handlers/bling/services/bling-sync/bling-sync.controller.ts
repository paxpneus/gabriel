import { Router, Request, Response } from "express";
import { authenticate, AuthRequest } from "../../../../../middlewares/auth-token";
import { validateData } from "../../../../../middlewares/validation";
import blingSyncService, { BlingSyncInputError } from "./bling-sync.service";
import { PopulateByIdSchema, PopulateSchema } from "./bling-sync.schema";
import {
  BlingSyncQueues,
  PopulateByIdRequest,
  PopulateRequest,
  PopulateRun,
} from "./bling-sync.types";

function getQueues(req: Request): BlingSyncQueues {
  return {
    apiFetchQueue: req.app.locals.BlingApiFetchQueue,
    orderQueue: req.app.locals.BlingOrderQueue,
  };
}

function getRequester(req: AuthRequest): PopulateRun["requestedBy"] {
  return req.application
    ? { id: req.application.id, type: "application" }
    : { id: req.user!.id, type: "user" };
}

export class BlingSyncController {
  public router = Router();

  constructor() {
    this.router.post(
      "/populate",
      authenticate,
      validateData(PopulateSchema),
      this.populate,
    );
    this.router.get("/populate/status", authenticate, this.populateStatus);
    this.router.post(
      "/populate-by-id",
      authenticate,
      validateData(PopulateByIdSchema),
      this.populateById,
    );
  }

  populate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const run = await blingSyncService.startPopulate(
        req.body as PopulateRequest,
        getQueues(req),
        getRequester(req as AuthRequest),
      );

      if (!run) {
        return res.status(409).json({
          error:
            "Já existe uma importação da Bling em andamento. Acompanhe em GET /bling-sync/populate/status.",
          run: await blingSyncService.getLastRun(),
        });
      }

      return res.status(202).json(run);
    } catch (error: any) {
      if (error instanceof BlingSyncInputError) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: error.message });
    }
  };

  populateStatus = async (_req: Request, res: Response): Promise<Response> => {
    try {
      const run = await blingSyncService.getLastRun();
      if (!run) {
        return res
          .status(404)
          .json({ error: "Nenhuma importação da Bling registrada." });
      }
      return res.status(200).json(run);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  populateById = async (req: Request, res: Response): Promise<Response> => {
    try {
      const body = req.body as PopulateByIdRequest;
      const results = await blingSyncService.populateByIds(body, getQueues(req));

      return res.status(202).json({
        entity: body.entity,
        enqueued: results.filter((r) => r.status === "ENQUEUED").length,
        skipped: results.filter((r) => r.status === "SKIPPED").length,
        failed: results.filter((r) => r.status === "FAILED").length,
        results,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new BlingSyncController();
