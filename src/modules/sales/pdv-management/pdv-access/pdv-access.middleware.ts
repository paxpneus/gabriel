import { NextFunction, Request, Response } from "express";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import userService from "../../../company/users/users/user.service";
import { userHasPermission } from "../../../../middlewares/user-permissions";
import { PdvAccessContext, PdvAccessScreen } from "./pdv-access.types";
import {
  computeStoreScreenToken,
  computeTelesalesToken,
  tokensMatch,
} from "./helpers/pdv-access-token.helper";

export interface PdvAccessRequest extends Request {
  pdvAccess?: PdvAccessContext;
}

// Cada tela vira uma entity própria em ROLE_PERMISSIONS (src/shared/constants/roles.ts),
// concedível independentemente por role.
const SCREEN_PERMISSION_ENTITY: Record<PdvAccessScreen, string> = {
  [PdvAccessScreen.STORE_REQUEST]: "pdv_sales_request_store",
  [PdvAccessScreen.FINANCE]: "pdv_sales_request_finance",
  [PdvAccessScreen.CD21]: "pdv_sales_request_cd21",
};

// Login não é uma rota separada — é só outro jeito de satisfazer a mesma
// checagem de tela, usando a loja atual do usuário (users.unit_business_id)
// em vez do header do link. Token de cookie inválido/usuário não encontrado
// não é erro fatal aqui — só significa "login não se aplica", cai pro link.
async function resolveLoginAccess(
  req: Request,
  requiredScreens: PdvAccessScreen[],
): Promise<PdvAccessContext | null> {
  const token = req.cookies?.token;
  if (!token) return null;

  let user: any;
  try {
    user = await userService.getMe(token);
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
      unitBusinessId: screen === PdvAccessScreen.CD21 ? null : userUnitBusinessId,
      userId: user.id,
    };
  }

  return null;
}

type LinkAccessResult =
  | { context: PdvAccessContext }
  | { error: { status: number; message: string } };

async function resolveLinkAccess(
  req: Request,
  requiredScreens: PdvAccessScreen[],
): Promise<LinkAccessResult> {
  const unitBusinessNumber = req.header("x-pdv-unit-business-number");
  const token = req.header("x-pdv-token");

  if (!unitBusinessNumber || !token) {
    return {
      error: {
        status: 400,
        message:
          "Cabeçalhos x-pdv-unit-business-number e x-pdv-token são obrigatórios.",
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

  // Televendas só satisfaz STORE_REQUEST, e nunca a loja CD21 — o "papel
  // das outras lojas" explicitamente exclui o hub central.
  if (requiredScreens.includes(PdvAccessScreen.STORE_REQUEST)) {
    const expectedTelesales = computeTelesalesToken();
    if (tokensMatch(token, expectedTelesales)) {
      const cd21 = await unitBusinessService.getCd21UnitBusiness();
      if (cd21 && unitBusiness.id === cd21.id) {
        return {
          error: {
            status: 403,
            message: "Televendas não acessa a loja CD21.",
          },
        };
      }
      return {
        context: {
          screen: PdvAccessScreen.STORE_REQUEST,
          via: "TELESALES_LINK",
          unitBusinessId: unitBusiness.id,
        },
      };
    }
  }

  return { error: { status: 401, message: "Token de acesso inválido." } };
}

export function pdvAccess(requiredScreens: PdvAccessScreen[]) {
  return async (
    req: PdvAccessRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> => {
    try {
      const loginContext = await resolveLoginAccess(req, requiredScreens);
      if (loginContext) {
        req.pdvAccess = loginContext;
        return next();
      }

      const linkResult = await resolveLinkAccess(req, requiredScreens);
      if ("error" in linkResult) {
        return res
          .status(linkResult.error.status)
          .json({ error: linkResult.error.message });
      }

      req.pdvAccess = linkResult.context;
      return next();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}
