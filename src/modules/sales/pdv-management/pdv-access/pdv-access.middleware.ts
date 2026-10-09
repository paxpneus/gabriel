import { NextFunction, Request, RequestHandler, Response } from "express";
import { PdvAccessContext, PdvAccessScreen } from "./pdv-access.types";
import {
  assertLinkParamsMatch,
  resolveLinkAccess,
  resolveLoginAccess,
} from "./helpers/resolve-pdv-access";

export interface PdvAccessRequest extends Request {
  pdvAccess?: PdvAccessContext;
}

// Adaptador Express fino sobre resolve-pdv-access.ts (núcleo transporte-agnóstico,
// reaproveitado também pelo auth de socket em pdv-socket-auth.middleware.ts) — só
// extrai cookie/headers da Request e aplica o resultado.
export function pdvAccess(requiredScreens: PdvAccessScreen[]) {
  return async (
    req: PdvAccessRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> => {
    try {
      const linkToken = req.header("x-pdv-token");
      const loginResult = await resolveLoginAccess(
        req.cookies?.token,
        requiredScreens,
      );
      if (loginResult && "context" in loginResult) {
        req.pdvAccess = loginResult.context;
        return next();
      }
      // Login sem acesso (loja 12/17, tela fora da rota) só cai pro link se houver token.
      if (loginResult && !linkToken) {
        return res
          .status(loginResult.error.status)
          .json({ error: loginResult.error.message });
      }

      const headerNumber = req.header("x-pdv-unit-business-number");
      const linkResult = await resolveLinkAccess(
        headerNumber,
        linkToken,
        requiredScreens,
      );
      if ("error" in linkResult) {
        return res
          .status(linkResult.error.status)
          .json({ error: linkResult.error.message });
      }

      const mismatch = assertLinkParamsMatch(
        linkResult.context,
        { screen: req.query.screen, number: req.query.number },
        headerNumber,
      );
      if (mismatch) {
        return res.status(mismatch.status).json({ error: mismatch.message });
      }

      req.pdvAccess = linkResult.context;
      return next();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

// Só usuário logado na tela exigida — link (x-pdv-token) não vale.
export function pdvLoginAccess(requiredScreens: PdvAccessScreen[]) {
  return async (
    req: PdvAccessRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> => {
    try {
      const loginResult = await resolveLoginAccess(
        req.cookies?.token,
        requiredScreens,
      );
      if (!loginResult) {
        return res
          .status(401)
          .json({ error: "Faça login com um usuário do CD21 para usar esta ação." });
      }
      if ("error" in loginResult) {
        return res
          .status(loginResult.error.status)
          .json({ error: loginResult.error.message });
      }

      req.pdvAccess = loginResult.context;
      return next();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

// Rota de login existente que também aceita o link PDV: com x-pdv-token usa só o
// link (sempre CD21, valida a tela); sem ele, cada middleware de login roda como
// antes. Um handler por middleware, retornando a promise dele, pro Express 5
// continuar capturando rejeição.
export function authenticateOrPdvLink(
  requiredScreens: PdvAccessScreen[],
  loginMiddlewares: RequestHandler[],
): RequestHandler[] {
  const isLink = (req: Request) => !!req.header("x-pdv-token");

  const linkHandler: RequestHandler = async (req, res, next) => {
    try {
      const linkResult = await resolveLinkAccess(
        req.header("x-pdv-unit-business-number"),
        req.header("x-pdv-token"),
        requiredScreens,
      );
      if ("error" in linkResult) {
        return void res
          .status(linkResult.error.status)
          .json({ error: linkResult.error.message });
      }

      (req as PdvAccessRequest).pdvAccess = linkResult.context;
      return next();
    } catch (error: any) {
      return void res.status(500).json({ error: error.message });
    }
  };

  return loginMiddlewares.map(
    (loginMiddleware, index): RequestHandler =>
      (req, res, next) => {
        if (!isLink(req)) return loginMiddleware(req, res, next);
        return index === 0 ? linkHandler(req, res, next) : next();
      },
  );
}
