import { Router, Request, Response } from "express";
import {
  authenticate,
  AuthRequest,
  getRequester,
} from "../../../middlewares/auth-token";
import { validateData } from "../../../middlewares/validation";
import manualImportService from "./manual-import.service";
import { ManualImportError } from "./manual-import.errors";
import {
  ManualImportConfirmSchema,
  ManualImportSearchSchema,
} from "./manual-import.schema";
import {
  ManualImportConfirmRequest,
  ManualImportQueues,
  ManualImportSearchRequest,
} from "./manual-import.types";

// Mesmas instâncias de fila que o resto da API usa (registradas em queues/index.ts).
function getQueues(req: Request): ManualImportQueues {
  return {
    blingApiFetch: req.app.locals.BlingApiFetchQueue,
    blingOrder: req.app.locals.BlingOrderQueue,
    tcarApiFetch: req.app.locals.TCarUpsertQueue,
    tcarInvoice: req.app.locals.TCarInvoiceQueue,
  };
}

// Erro de regra → status/body próprios; erro HTTP da integração → 502; o resto → 500.
function handleError(res: Response, error: any): Response {
  if (error instanceof ManualImportError) {
    return res.status(error.httpStatus).json(error.body);
  }
  const upstreamStatus = error?.response?.status;
  if (upstreamStatus) {
    return res.status(502).json({
      code: "INTEGRATION_REQUEST_FAILED",
      message: `A integração respondeu ${upstreamStatus}`,
      error: error?.response?.data?.message ?? error.message,
    });
  }
  return res.status(500).json({ error: error?.message });
}

// Só request/response: requester, filas e status HTTP; a regra fica no service.
export class ManualImportController {
  public router = Router();

  // Sem model na pasta → sem checagem de permissão por entidade; só authenticate.
  constructor() {
    this.router.post(
      "/",
      authenticate,
      validateData(ManualImportSearchSchema),
      this.search,
    );
    this.router.post(
      "/confirm",
      authenticate,
      validateData(ManualImportConfirmSchema),
      this.confirm,
    );
    this.router.get("/status", authenticate, this.status);
    this.router.get("/options", authenticate, this.options);
  }

  // POST / — busca na integração (NOT_FOUND / CHOOSE); nada é importado aqui.
  search = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { httpStatus, body } = await manualImportService.search(
        req.body as ManualImportSearchRequest,
        getRequester(req as AuthRequest),
        getQueues(req),
      );
      return res.status(httpStatus).json(body);
    } catch (error: any) {
      return handleError(res, error);
    }
  };

  // POST /confirm — enfileira os itens escolhidos da lista do CHOOSE.
  confirm = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { httpStatus, body } = await manualImportService.confirm(
        req.body as ManualImportConfirmRequest,
        getRequester(req as AuthRequest),
        getQueues(req),
      );
      return res.status(httpStatus).json(body);
    } catch (error: any) {
      return handleError(res, error);
    }
  };

  // GET /options — integrações, entidades e tipos de busca aceitos, pra montar a tela.
  options = async (_req: Request, res: Response): Promise<Response> => {
    try {
      return res.status(200).json(await manualImportService.getOptions());
    } catch (error: any) {
      return handleError(res, error);
    }
  };

  // GET /status — andamento do import do usuário, consultado em polling pelo front.
  status = async (req: Request, res: Response): Promise<Response> => {
    try {
      const status = await manualImportService.getStatus(
        getRequester(req as AuthRequest),
        getQueues(req),
      );
      return res.status(200).json(status);
    } catch (error: any) {
      return handleError(res, error);
    }
  };
}

export default new ManualImportController();
