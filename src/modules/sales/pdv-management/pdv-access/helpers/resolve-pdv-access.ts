import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import userService from "../../../../company/users/users/user.service";
import { userHasPermission } from "../../../../../middlewares/user-permissions";
import { PdvAccessContext, PdvAccessScreen } from "../pdv-access.types";
import {
  computeFinanceToken,
  computeStoreScreenToken,
  computeTelesalesToken,
  tokensMatch,
} from "./pdv-access-token.helper";

// Núcleo de resolução do pdvAccess, sem nada de Express/Socket.IO — reaproveitado
// pelo middleware HTTP e pelo auth de socket (pdv-socket-auth.middleware.ts).

// Cada tela vira uma entity própria em ROLE_PERMISSIONS (src/shared/constants/roles.ts),
// concedível independentemente por role.
const SCREEN_PERMISSION_ENTITY: Record<PdvAccessScreen, string> = {
  [PdvAccessScreen.STORE_REQUEST]: "pdv_sales_request_store",
  [PdvAccessScreen.FINANCE]: "pdv_sales_request_finance",
  [PdvAccessScreen.CD21]: "pdv_sales_request_cd21",
};

// Login não é uma rota separada — é só outro jeito de satisfazer a mesma
// checagem de tela, usando a loja atual do usuário (users.unit_business_id)
// em vez do header/handshake do link. Cookie ausente/inválido não é erro
// fatal aqui — só significa "login não se aplica", cai pro link.
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
  if (!user?.role) return null;

  const cd21 = await unitBusinessService.getCd21UnitBusiness();
  const userUnitBusinessId: string | null = user.unit_business_id ?? null;

  for (const screen of requiredScreens) {
    let storeContextOk: boolean;
    if (screen === PdvAccessScreen.CD21) {
      storeContextOk = !!cd21 && userUnitBusinessId === cd21.id;
    } else if (screen === PdvAccessScreen.STORE_REQUEST) {
      storeContextOk = !!userUnitBusinessId && userUnitBusinessId !== cd21?.id;
    } else if (screen === PdvAccessScreen.FINANCE) {
      // Financeiro é global (igual CD21) — não depende da loja do usuário.
      storeContextOk = true;
    } else {
      storeContextOk = !!userUnitBusinessId;
    }
    if (!storeContextOk) continue;

    if (!userHasPermission(user.role, SCREEN_PERMISSION_ENTITY[screen], "write")) {
      continue;
    }

    return {
      screen,
      via: "LOGIN",
      unitBusinessId:
        screen === PdvAccessScreen.CD21 || screen === PdvAccessScreen.FINANCE
          ? null
          : userUnitBusinessId,
      userId: user.id,
    };
  }

  return null;
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
