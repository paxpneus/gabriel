import unitBusinessService from "../../../company/unit-business/unit-business.service";
import { PdvAccessScreen } from "./pdv-access.types";
import {
  computeStoreScreenToken,
  computeTelesalesToken,
} from "./helpers/pdv-access-token.helper";

const STORE_SCREENS = [
  PdvAccessScreen.STORE_REQUEST,
  PdvAccessScreen.FINANCE,
  PdvAccessScreen.CD21,
];

// Front tem uma única rota /pdv-management (query string carrega screen,
// não path por tela) — confirmado testando contra o router real.
const TELESALES_SCREEN_PARAM = "telesales";

function buildFrontendUrl(
  token: string,
  screenParam: string,
  unitBusinessNumber?: string,
): string {
  const baseUrl = process.env.FRONTEND_URL ?? "https://hub.paxpneus.com.br";
  const params = new URLSearchParams({ token, screen: screenParam });
  if (unitBusinessNumber) params.set("number", unitBusinessNumber);
  return `${baseUrl}/pdv-management?${params.toString()}`;
}

export class PdvAccessLinkService {
  // Token é derivado, não persistido — este método só resolve os valores
  // computados pra quem já tem acesso à tela (via pdvAccess), pra montar o
  // link/copiar pro time que ainda não tem.
  async getLinksForStore(unitBusinessId: string) {
    const unitBusiness = await unitBusinessService.findById(unitBusinessId);
    if (!unitBusiness) throw new Error("Loja não encontrada");

    return STORE_SCREENS.map((screen) => ({
      screen,
      unitBusinessNumber: unitBusiness.number,
      url: buildFrontendUrl(
        computeStoreScreenToken(unitBusiness.number, screen),
        screen.toLowerCase(),
        unitBusiness.number,
      ),
    }));
  }

  getTelesalesLink() {
    return {
      url: buildFrontendUrl(computeTelesalesToken(), TELESALES_SCREEN_PARAM),
    };
  }
}

export default new PdvAccessLinkService();
