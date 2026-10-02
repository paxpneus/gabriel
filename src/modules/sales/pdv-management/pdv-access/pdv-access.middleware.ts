import { NextFunction, Request, RequestHandler, Response } from "express";
import { PdvAccessContext, PdvAccessScreen } from "./pdv-access.types";
import { resolveLoginAccess, resolveLinkAccess } from "./helpers/resolve-pdv-access";

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
      const loginContext = await resolveLoginAccess(
        req.cookies?.token,
        requiredScreens,
      );
      if (loginContext) {
        req.pdvAccess = loginContext;
        return next();
      }

      const linkResult = await resolveLinkAccess(
        req.header("x-pdv-unit-business-number"),
        req.header("x-pdv-token"),
        requiredScreens,
      );
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
