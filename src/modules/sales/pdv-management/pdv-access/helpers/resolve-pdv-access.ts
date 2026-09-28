import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import userService from "../../../../company/users/users/user.service";
import { CD21_UNIT_BUSINESS_NUMBER } from "../../../../company/unit-business/helpers/cd21-unit-business-number";
import { PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS } from "../../helpers/pdv-excluded-unit-business";
import { PdvAccessContext, PdvAccessScreen } from "../pdv-access.types";
import {
  computeFinanceToken,
  computeStoreScreenToken,
  computeTelesalesToken,
  tokensMatch,
} from "./pdv-access-token.helper";

// Núcleo de resolução do pdvAccess, sem nada de Express/Socket.IO — reaproveitado
// pelo middleware HTTP e pelo auth de socket (pdv-socket-auth.middleware.ts).

// Determinístico a partir dos próprios dados do usuário — NUNCA via
// ROLE_PERMISSIONS/userHasPermission (havia um caminho antigo por lá, mas
// `pdv_sales_request_store` nunca ficou concedível em USER_TYPES — nenhuma
// role real conseguia a permissão —, então usuário de loja de verdade sempre
// falhava esse check e, em rota que aceita mais de uma tela, caía errado em
// FINANCE/CD21 por permissão residual do resto do role). A tela é 100%
// função de user_config.type + unit_business do próprio usuário:
// - type === "finance" → FINANCE (global, sem loja);
// - loja é a CD21 (number da unit business) → CD21 (global, sem loja);
// - qualquer outra loja, exceto as que o PDV não atende (CD21/12/17, ver
//   PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS) → STORE_REQUEST, escopado nela.
// unit_business_id/unitBusiness.number/config.type já vêm de graça em
// getMe/getFullUser (user.repository.ts) — sem query extra aqui.
function resolveScreenForUser(user: any): PdvAccessScreen | null {
  if (user.config?.type === "finance") return PdvAccessScreen.FINANCE;

  const storeNumber: string | undefined = user.unitBusiness?.number;
  if (storeNumber === CD21_UNIT_BUSINESS_NUMBER) return PdvAccessScreen.CD21;

  if (
    !storeNumber ||
    PDV_UNSUPPORTED_UNIT_BUSINESS_NUMBERS.includes(storeNumber)
  ) {
    return null;
  }

  return PdvAccessScreen.STORE_REQUEST;
}

// Login não é uma rota separada — é só outro jeito de satisfazer a mesma
// checagem de tela, usando a loja/tipo atuais do usuário em vez do
// header/handshake do link. Cookie ausente/inválido não é erro fatal aqui —
// só significa "login não se aplica", cai pro link.
export async function resolveLoginAccess(
  cookieToken: string | undefined,
  requiredScreens: PdvAccessScreen[],
): Promise<PdvAccessContext | null> {
  if (!cookieToken) return null;

  let user: any;
  try {
    user = await userService.getMe(cookieToken);
  } catch {
    return null;
  }
  if (!user) return null;

  const screen = resolveScreenForUser(user);
  if (!screen || !requiredScreens.includes(screen)) return null;

  return {
    screen,
    via: "LOGIN",
    unitBusinessId:
      screen === PdvAccessScreen.CD21 || screen === PdvAccessScreen.FINANCE
        ? null
        : (user.unit_business_id ?? null),
    userId: user.id,
  };
}

export type LinkAccessResult =
  | { context: PdvAccessContext }
  | { error: { status: number; message: string } };

export async function resolveLinkAccess(
  unitBusinessNumber: string | undefined,
  token: string | undefined,
  requiredScreens: PdvAccessScreen[],
): Promise<LinkAccessResult> {
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
