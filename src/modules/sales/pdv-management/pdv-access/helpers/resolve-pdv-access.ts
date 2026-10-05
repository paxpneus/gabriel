import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import userService from "../../../../company/users/users/user.service";
import { CD21_UNIT_BUSINESS_NUMBER } from "../../../../company/unit-business/helpers/cd21-unit-business-number";
import { PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS } from "../../helpers/pdv-excluded-unit-business";
import { FINANCE_USER_TYPE } from "../../../../../shared/constants/user-types";
import { PdvAccessContext, PdvAccessScreen } from "../pdv-access.types";
import {
  LINK_SCREEN_PARAMS,
  resolveBoardScreen,
} from "../../helpers/pdv-screens.config";
import {
  computeFinanceToken,
  computeStoreScreenToken,
  computeTelesalesToken,
  tokensMatch,
} from "./pdv-access-token.helper";

// Núcleo de resolução do pdvAccess, sem nada de Express/Socket.IO — reaproveitado
// pelo middleware HTTP e pelo auth de socket (pdv-socket-auth.middleware.ts).

export type PdvAccessResult =
  | { context: PdvAccessContext }
  | { error: { status: number; message: string } };

const UNSUPPORTED_STORE = "UNSUPPORTED_STORE";

// Determinístico a partir dos próprios dados do usuário — NUNCA via
// ROLE_PERMISSIONS/userHasPermission (havia um caminho antigo por lá, mas
// `pdv_sales_request_store` nunca ficou concedível em USER_TYPES — nenhuma
// role real conseguia a permissão —, então usuário de loja de verdade sempre
// falhava esse check e, em rota que aceita mais de uma tela, caía errado em
// FINANCE/CD21 por permissão residual do resto do role). A tela é 100%
// função de user.type (espelho de user_config.type, mesmo campo que o front
// usa) + unit_business do próprio usuário:
// - user.type === FINANCE_USER_TYPE → FINANCE (global, sem loja);
// - loja é a CD21 (number da unit business) → CD21 (global, sem loja);
// - loja que o PDV não atende (12/17, ver PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS)
//   → UNSUPPORTED_STORE (403 sem link);
// - qualquer outra loja → STORE_REQUEST, escopado nela.
// unit_business_id/unitBusiness.number/type já vêm de graça em
// getMe/getFullUser (user.repository.ts) — sem query extra aqui.
function resolveScreenForUser(
  user: any,
): PdvAccessScreen | typeof UNSUPPORTED_STORE | null {
  if (user.type === FINANCE_USER_TYPE) return PdvAccessScreen.FINANCE;

  const storeNumber: string | undefined = user.unitBusiness?.number;
  if (storeNumber === CD21_UNIT_BUSINESS_NUMBER) return PdvAccessScreen.CD21;
  if (!storeNumber) return null;
  if (PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS.includes(storeNumber)) {
    return UNSUPPORTED_STORE;
  }

  return PdvAccessScreen.STORE_REQUEST;
}

// Login não é uma rota separada — é só outro jeito de satisfazer a mesma
// checagem de tela, usando a loja/tipo atuais do usuário em vez do
// header/handshake do link. Cookie ausente/inválido ou usuário sem loja → null
// (cai pro link). Loja 12/17 ou tela fora da rota → erro 403 explícito; o
// chamador ainda tenta o link se houver x-pdv-token.
export async function resolveLoginAccess(
  cookieToken: string | undefined,
  requiredScreens: PdvAccessScreen[],
): Promise<PdvAccessResult | null> {
  if (!cookieToken) return null;

  let user: any;
  try {
    user = await userService.getMe(cookieToken);
  } catch {
    return null;
  }
  if (!user) return null;

  const screen = resolveScreenForUser(user);
  if (!screen) return null;
  if (screen === UNSUPPORTED_STORE) {
    return {
      error: { status: 403, message: "Loja sem acesso ao PDV Management." },
    };
  }
  if (!requiredScreens.includes(screen)) {
    return {
      error: { status: 403, message: "Sua tela não tem acesso a este recurso." },
    };
  }

  return {
    context: {
      screen,
      via: "LOGIN",
      unitBusinessId:
        screen === PdvAccessScreen.CD21 || screen === PdvAccessScreen.FINANCE
          ? null
          : (user.unit_business_id ?? null),
      userId: user.id,
    },
  };
}

export async function resolveLinkAccess(
  unitBusinessNumber: string | undefined,
  token: string | undefined,
  requiredScreens: PdvAccessScreen[],
): Promise<PdvAccessResult> {
  if (!token) {
    return {
      error: { status: 400, message: "Token (x-pdv-token) é obrigatório." },
    };
  }

  // Financeiro é global e não amarrado a nenhuma loja — token fixo, sem
  // precisar de x-pdv-unit-business-number nenhum.
  if (requiredScreens.includes(PdvAccessScreen.FINANCE)) {
    const expectedFinance = computeFinanceToken();
    if (tokensMatch(token, expectedFinance)) {
      return {
        context: {
          screen: PdvAccessScreen.FINANCE,
          via: "STORE_LINK",
          unitBusinessId: null,
        },
      };
    }
  }

  // Televendas também é global, igual Financeiro — token fixo, sem loja
  // selecionada, enxerga pedido de qualquer loja física normal (nunca CD21
  // nem online/marketplace: exclusão feita na resolução do escopo, ver
  // unitBusinessService.getPhysicalNumberedUnitBusinessIds, não aqui).
  if (requiredScreens.includes(PdvAccessScreen.STORE_REQUEST)) {
    const expectedTelesales = computeTelesalesToken();
    if (tokensMatch(token, expectedTelesales)) {
      return {
        context: {
          screen: PdvAccessScreen.STORE_REQUEST,
          via: "TELESALES_LINK",
          unitBusinessId: null,
        },
      };
    }
  }

  if (!unitBusinessNumber) {
    return {
      error: {
        status: 400,
        message: "Número da loja (x-pdv-unit-business-number) é obrigatório.",
      },
    };
  }

  const unitBusiness = await unitBusinessService.findOne({
    where: { number: unitBusinessNumber },
  });
  if (!unitBusiness) {
    return { error: { status: 404, message: "Loja não encontrada." } };
  }

  for (const screen of requiredScreens) {
    if (screen === PdvAccessScreen.FINANCE) continue; // já tratado acima
    const expected = computeStoreScreenToken(unitBusinessNumber, screen);
    if (tokensMatch(token, expected)) {
      return {
        context: {
          screen,
          via: "STORE_LINK",
          unitBusinessId: screen === PdvAccessScreen.CD21 ? null : unitBusiness.id,
        },
      };
    }
  }

  return { error: { status: 401, message: "Token de acesso inválido." } };
}

export interface PdvLinkParams {
  screen?: unknown;
  number?: unknown;
}

// `screen`/`number` da URL do link têm que bater com o que o token liberou —
// token inválido já é 401 antes (o número entra no HMAC). Só pra acesso via link.
// TODO: tornar `screen`/`number` obrigatórios quando o front passar a enviar sempre.
export function assertLinkParamsMatch(
  context: PdvAccessContext,
  params: PdvLinkParams,
  headerNumber: string | undefined,
): { status: number; message: string } | null {
  const boardScreen = resolveBoardScreen(context);

  if (params.screen !== undefined) {
    const linkScreen =
      typeof params.screen === "string" ? LINK_SCREEN_PARAMS[params.screen] : undefined;
    if (!linkScreen) {
      return { status: 400, message: "Parâmetro \"screen\" inválido." };
    }
    if (linkScreen !== boardScreen) {
      return { status: 403, message: "Tela não corresponde ao link de acesso." };
    }
  }

  if (params.number !== undefined) {
    const numberBoundToToken = boardScreen === "store" || boardScreen === "cd21";
    if (!numberBoundToToken || params.number !== headerNumber) {
      return { status: 403, message: "Loja não corresponde ao link de acesso." };
    }
  }

  return null;
}
