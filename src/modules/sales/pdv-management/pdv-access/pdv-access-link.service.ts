import unitBusinessService from "../../../company/unit-business/unit-business.service";
import { UnitBusinessAttributes } from "../../../company/unit-business/unit-business.types";
import { PdvAccessScreen } from "./pdv-access.types";
import {
  computeStoreScreenToken,
  computeTelesalesToken,
} from "./helpers/pdv-access-token.helper";
import redisService from "../../../../shared/utils/base-models/base-redis";

// Front tem uma única rota /pdv-management (query string carrega screen,
// não path por tela) — confirmado testando contra o router real.
const TELESALES_SCREEN_PARAM = "telesales";

// Token/URL não mudam sozinhos (só se a loja for renomeada ou o secret
// rotacionar, ambos raros) — 1h de cache é aceitável mesmo sem invalidação
// ativa (evita acoplar esse módulo ao write path de unit-business).
const ACCESS_LINKS_CACHE_TTL_SECONDS = 60 * 60;

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

export interface PdvStoreAccessLinks {
  unitBusinessId: string;
  unitBusinessNumber: string;
  unitBusinessName: string;
  storeRequestUrl: string;
  financeUrl: string;
  cd21Url: string;
  telesalesUrl: string;
}

export class PdvAccessLinkService {
  // Tokens são derivados, não persistidos (helpers/pdv-access-token.helper.ts)
  // — este service só resolve os valores computados pra quem já tem acesso a
  // alguma tela (via pdvAccess), pra montar/distribuir o link pro time que
  // ainda não tem.
  //
  // CD21 e televendas são globais (mesmo link pra qualquer loja) — cd21Url
  // usa sempre o número da própria unidade CD21 (nunca o da loja consultada,
  // já que a fórmula é HMAC(secret, `store:<número>:CD21`) e só o número real
  // da CD21 autentica como acesso global de verdade).
  private buildLinksForStore(
    unitBusiness: Pick<UnitBusinessAttributes, "id" | "number" | "name">,
    cd21: Pick<UnitBusinessAttributes, "number">,
  ): PdvStoreAccessLinks {
    return {
      unitBusinessId: unitBusiness.id,
      unitBusinessNumber: unitBusiness.number,
      unitBusinessName: unitBusiness.name,
      storeRequestUrl: buildFrontendUrl(
        computeStoreScreenToken(
          unitBusiness.number,
          PdvAccessScreen.STORE_REQUEST,
        ),
        PdvAccessScreen.STORE_REQUEST.toLowerCase(),
        unitBusiness.number,
      ),
      financeUrl: buildFrontendUrl(
        computeStoreScreenToken(unitBusiness.number, PdvAccessScreen.FINANCE),
        PdvAccessScreen.FINANCE.toLowerCase(),
        unitBusiness.number,
      ),
      cd21Url: buildFrontendUrl(
        computeStoreScreenToken(cd21.number, PdvAccessScreen.CD21),
        PdvAccessScreen.CD21.toLowerCase(),
        cd21.number,
      ),
      telesalesUrl: buildFrontendUrl(
        computeTelesalesToken(),
        TELESALES_SCREEN_PARAM,
      ),
    };
  }

  private accessLinksCacheKey(unitBusinessId?: string): string {
    return unitBusinessId
      ? `pdv-access:links:store:${unitBusinessId}`
      : "pdv-access:links:all";
  }

  // unitBusinessId informado: só os links dessa loja. Omitido: todas as lojas
  // comerciais (mesmo filtro de getComercialUnitBusinessOnly — exclui
  // marketplace/loja "0"). cd21 é resolvido uma única vez fora do map, nunca
  // por loja (evitaria N+1 na listagem completa).
  async getAccessLinks(
    unitBusinessId?: string,
  ): Promise<PdvStoreAccessLinks | PdvStoreAccessLinks[]> {
    const cacheKey = this.accessLinksCacheKey(unitBusinessId);
    const cached = await redisService.get<
      PdvStoreAccessLinks | PdvStoreAccessLinks[]
    >(cacheKey);
    if (cached !== null) return cached;

    const cd21 = await unitBusinessService.getCd21UnitBusiness();
    if (!cd21) throw new Error("Unidade CD21 não cadastrada");

    let result: PdvStoreAccessLinks | PdvStoreAccessLinks[];
    if (unitBusinessId) {
      const unitBusiness = await unitBusinessService.findById(unitBusinessId);
      if (!unitBusiness) throw new Error("Loja não encontrada");
      result = this.buildLinksForStore(unitBusiness, cd21);
    } else {
      const stores = await unitBusinessService.getComercialUnitBusinessOnly();
      result = stores.map((store) => this.buildLinksForStore(store, cd21));
    }

    await redisService.set(cacheKey, result, {
      mode: "EX",
      duration: ACCESS_LINKS_CACHE_TTL_SECONDS,
    });
    return result;
  }
}

export default new PdvAccessLinkService();
