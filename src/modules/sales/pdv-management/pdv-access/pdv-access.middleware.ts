import { NextFunction, Request, Response } from "express";
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
