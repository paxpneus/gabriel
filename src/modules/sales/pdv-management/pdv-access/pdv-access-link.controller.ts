import { Request, RequestHandler, Response } from "express";
import RouterController from "../../../../shared/utils/base-models/base-router-controller";
import { pdvAccess } from "./pdv-access.middleware";
import { PdvAccessScreen } from "./pdv-access.types";
import pdvAccessLinkService from "./pdv-access-link.service";

// Devolve o link/token de cada tela do PDV Management pra quem já tem acesso
// a alguma delas — token não fica salvo em nenhum lugar (é derivado, ver
// helpers/pdv-access-token.helper.ts), então isto é o único jeito de obter o
// valor computado sem conhecer o segredo.
const ALL_SCREENS = [
  PdvAccessScreen.STORE_REQUEST,
  PdvAccessScreen.FINANCE,
  PdvAccessScreen.CD21,
];

export class PdvAccessLinkController extends RouterController {
  constructor() {
    super();
    this.registerRoutes();
  }

  protected middlewaresFor(): Record<string, RequestHandler[]> {
    return {
      links: [pdvAccess(ALL_SCREENS)],
    };
  }

  protected registerRoutes(): void {
    this.router.get("/links", ...this.mw("links"), this.getLinks);
  }

  // ?unitBusinessId=<id> → `store` (link dessa loja); omitido → `stores`
  // (todas as lojas comerciais). `general` (CD21/financeiro/televendas,
  // acesso global) vem sempre, nos dois casos — ver pdv-access-link.service.ts.
  getLinks = async (req: Request, res: Response): Promise<Response> => {
    try {
      const links = await pdvAccessLinkService.getAccessLinks(
        req.query.unitBusinessId as string | undefined,
      );
      return res.json(links);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new PdvAccessLinkController();
