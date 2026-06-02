// middlewares/auth.ts
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import 'dotenv/config'
import applicationService from '../modules/integrations/applications/applications.service';
import { ApplicationTokenPayload, ApplicationRequestAttributes } from '../modules/integrations/applications/applications.types';
import { enforceApplicationRateLimit } from './application-rate-limit';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
  application?: ApplicationRequestAttributes;
}

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.replace("Bearer ", "").trim();
}

function applicationRouteAllowed(
  req: Request,
  allowedRoutes: string[],
): boolean {
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return false;
  }
  if (allowedRoutes.includes("*")) return true;

  const cleanPath = req.originalUrl.split("?")[0];
  const apiPath = cleanPath.replace(/^\/api\/?/, "");
  const baseSegment = apiPath.split("/")[0];

  return allowedRoutes.some((route) => {
    const normalized = route
      .replace(/^\/api\/?/, "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");

    return normalized === baseSegment || normalized === apiPath;
  });
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.token ?? getBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      role: string;
      type?: string;
      tokenVersion?: number;
    };

    if (payload.type === "application") {
      const appPayload = payload as ApplicationTokenPayload;
      const application =
        (await applicationService.getAuthenticatedApplication(
          appPayload.id,
        )) as ApplicationRequestAttributes | null;

      if (!application) {
        return res.status(401).json({ error: "Aplicativo inválido ou inativo" });
      }

      if (application.token_version !== appPayload.tokenVersion) {
        return res.status(401).json({ error: "Token de aplicativo revogado" });
      }

      if (!applicationRouteAllowed(req, application.allowed_routes)) {
        return res.status(403).json({
          error: "Rota não liberada para este aplicativo.",
        });
      }

      req.application = application;
      req.user = { id: application.id, role: application.role_id };
      const rateLimit = await enforceApplicationRateLimit(req);
      if (!rateLimit.allowed) {
        return res.status(429).json(rateLimit.body);
      }
      return next();
    }

    req.user = payload; 
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}
