import { Request, Response } from "express";
import RouterController from "../../../../../../../shared/utils/base-models/base-router-controller";
import { authenticate } from "../../../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../../../middlewares/user-permissions";
import internalInvoiceService from "../services/internal.service";
import { extractUnitBusinessIdFromRequest } from "../../shared";

// Rotas da nota interna (série B Tecinco); montado pelo invoice.routes.ts antes do core.
class InternalController extends RouterController {
  constructor() {
    super();

    this.router.get("/internal/list", ...this.mw("listInternalInvoices"), this.listInternalInvoices);
  }

  protected middlewaresFor() {
    return {
      listInternalInvoices: [authenticate, userPermissions],
    };
  }

  // Igual ao /transfer/list: sem unitBusinessId no request, lista as notas internas de todas as lojas.
  listInternalInvoices = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const unitBusinessId = extractUnitBusinessIdFromRequest(req);
      const result = await internalInvoiceService.listInternalInvoices(params, unitBusinessId);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new InternalController();
