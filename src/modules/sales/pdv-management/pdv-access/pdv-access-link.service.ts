import unitBusinessService from "../../../company/unit-business/unit-business.service";
import { UnitBusinessAttributes } from "../../../company/unit-business/unit-business.types";
import { PdvAccessScreen } from "./pdv-access.types";
import {
  computeFinanceToken,
  computeStoreScreenToken,
  computeTelesalesToken,
} from "./helpers/pdv-access-token.helper";
import redisService from "../../../../shared/utils/base-models/base-redis";
import { PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS } from "../helpers/pdv-excluded-unit-business";

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

// STORE_REQUEST é a única tela realmente escopada por loja — cada uma tem
// seu próprio link/token.
export interface PdvStoreRequestLink {
  unitBusinessId: string;
  unitBusinessNumber: string;
  unitBusinessName: string;
  storeRequestUrl: string;
}

// CD21, financeiro e televendas são acesso global — um único link cada,
// nunca varia por loja (nem repetido por loja na resposta).
export interface PdvGeneralAccessLinks {
  cd21Url: string;
  financeUrl: string;
  telesalesUrl: string;
}

export interface PdvAccessLinksResult {
  general: PdvGeneralAccessLinks;
  // Números de unit business que o front deve tratar como "sem PDV" (ex.:
  // esconder a ação de gerar link numa tela que lista todas as unit
  // businesses do sistema) — mesma lista que já filtra `store`/`stores`
  // aqui, exposta pra quem lista lojas por outra via.
  unsupportedUnitBusinessNumbers: string[];
  store?: PdvStoreRequestLink;
  stores?: PdvStoreRequestLink[];
}

export class PdvAccessLinkService {
  // Tokens são derivados, não persistidos (helpers/pdv-access-token.helper.ts)
  // — este service só resolve os valores computados pra quem já tem acesso a
  // alguma tela (via pdvAccess), pra montar/distribuir o link pro time que
  // ainda não tem.
  private buildStoreRequestLink(
    unitBusiness: Pick<UnitBusinessAttributes, "id" | "number" | "name">,
  ): PdvStoreRequestLink {
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
    };
  }

  // cd21Url usa sempre o número da própria unidade CD21 (nunca de uma loja
  // qualquer), já que a fórmula é HMAC(secret, `store:<número>:CD21`) e só o
  // número real da CD21 autentica como acesso global de verdade. financeUrl/
  // telesalesUrl são token fixo, não amarrados a loja nenhuma.
  private buildGeneralLinks(
    cd21: Pick<UnitBusinessAttributes, "number">,
  ): PdvGeneralAccessLinks {
    return {
      cd21Url: buildFrontendUrl(
        computeStoreScreenToken(cd21.number, PdvAccessScreen.CD21),
        PdvAccessScreen.CD21.toLowerCase(),
        cd21.number,
      ),
      financeUrl: buildFrontendUrl(
        computeFinanceToken(),
        PdvAccessScreen.FINANCE.toLowerCase(),
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

  // CD21 e PDV_EXCLUDED_STORE_NUMBERS (juntos, PDV_UNSUPPORTED_UNIT_BUSINESS_
  // NUMBERS) nunca têm storeRequestUrl — não participam do fluxo PDV (ver
  // helpers/pdv-excluded-unit-business.ts). CD21 continua tendo seu próprio
  // link (cd21Url, em `general`), só não um storeRequestUrl "como se fosse
  // uma loja normal".
  private isExcludedFromStoreRequestLink(
    unitBusiness: Pick<UnitBusinessAttributes, "number">,
  ): boolean {
    return PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS.includes(
      unitBusiness.number,
    );
  }

  // unitBusinessId informado: `store` com o link dessa loja. Omitido:
  // `stores` com todas as lojas comerciais (mesmo filtro de
  // getComercialUnitBusinessOnly — exclui marketplace/loja "0" — mais
  // PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS, ver isExcludedFromStoreRequestLink).
  // `general`/`unsupportedUnitBusinessNumbers` vêm sempre, calculados uma
  // única vez (nunca por loja, evita N+1 e repetição na listagem completa).
  async getAccessLinks(unitBusinessId?: string): Promise<PdvAccessLinksResult> {
    const cacheKey = this.accessLinksCacheKey(unitBusinessId);
    const cached = await redisService.get<PdvAccessLinksResult>(cacheKey);
    if (cached !== null) return cached;

    const cd21 = await unitBusinessService.getCd21UnitBusiness();
    if (!cd21) throw new Error("Unidade CD21 não cadastrada");

    const general = this.buildGeneralLinks(cd21);
    const unsupportedUnitBusinessNumbers = PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS;

    let result: PdvAccessLinksResult;
    if (unitBusinessId) {
      const unitBusiness = await unitBusinessService.findById(unitBusinessId);
      if (!unitBusiness) throw new Error("Loja não encontrada");
      if (this.isExcludedFromStoreRequestLink(unitBusiness)) {
        throw new Error("Loja não participa do fluxo do PDV Management");
      }
      result = {
        general,
        unsupportedUnitBusinessNumbers,
        store: this.buildStoreRequestLink(unitBusiness),
      };
    } else {
      const stores = await unitBusinessService.getComercialUnitBusinessOnly();
      result = {
        general,
        unsupportedUnitBusinessNumbers,
        stores: stores
          .filter((store) => !this.isExcludedFromStoreRequestLink(store))
          .map((store) => this.buildStoreRequestLink(store)),
      };
    }

    await redisService.set(cacheKey, result, {
      mode: "EX",
      duration: ACCESS_LINKS_CACHE_TTL_SECONDS,
    });
    return result;
  }
}

export default new PdvAccessLinkService();
