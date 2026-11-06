import { Request, RequestHandler, Response } from "express";
import RouterController from "../../../../shared/utils/base-models/base-router-controller";
import paymentMethodService from "./payment_method.service";
import { pdvAccess } from "../../pdv-management/pdv-access/pdv-access.middleware";
import { PdvAccessScreen } from "../../pdv-management/pdv-access/pdv-access.types";

// Só leitura — catálogo é populado pelo sync da Bling, nunca editado via API.
export class PaymentMethodController extends RouterController {
  constructor() {
    super();
    this.router.get("/", ...this.mw("index"), this.index);
    this.router.get("/card-brands", ...this.mw("cardBrands"), this.cardBrands);
    this.router.get("/installments", ...this.mw("installments"), this.installments);
  }

  protected middlewaresFor(): Record<string, RequestHandler[]> {
    const pdvScreens = pdvAccess([
      PdvAccessScreen.STORE_REQUEST,
      PdvAccessScreen.FINANCE,
      PdvAccessScreen.CD21,
    ]);
    return {
      index: [pdvScreens],
      cardBrands: [pdvScreens],
      installments: [pdvScreens],
    };
  }

  // GET /card-brands — bandeiras de cartão (código NF-e + nome), lista fixa sem paginação.
  cardBrands = async (_req: Request, res: Response): Promise<Response> => {
    return res.json({ data: paymentMethodService.listCardBrands() });
  };

  // GET /installments — opções de parcelas (1x até MAX_INSTALLMENTS), lista fixa sem paginação.
  installments = async (_req: Request, res: Response): Promise<Response> => {
    return res.json({ data: paymentMethodService.listInstallmentOptions() });
  };

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { page, perPage, sortBy, sortDir, search } =
        this.extractQueryParams(req);
      const result = await paymentMethodService.paginateList({
        page,
        perPage,
        sortBy,
        sortDir,
        search,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new PaymentMethodController();
