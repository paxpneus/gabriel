// middlewares/auth.ts
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import "dotenv/config";
import applicationService from "../modules/integrations/applications/applications.service";
import {
  ApplicationTokenPayload,
  ApplicationRequestAttributes,
} from "../modules/integrations/applications/applications.types";
import { enforceApplicationRateLimit } from "./application-rate-limit";
import { ROLE_PERMISSIONS } from "../shared/constants/roles";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
  application?: ApplicationRequestAttributes;
}


function getRoutesFromRole(rolePermissions: string[]): string[] {
  const routes: string[] = [];

  for (const permission of rolePermissions) {
    const config = ROLE_PERMISSIONS.find(
      (r) => r.entity === permission || r.route === permission
    );

    if (config) {
      routes.push(config.route);
    }
  }

  return routes;
}

function expandAllowedRoutes(routes: string[]): string[] {
  const expanded = new Set<string>();

  for (const route of routes) {
    expanded.add(route);

    const config = ROLE_PERMISSIONS.find(
      (r) => r.route === route || r.entity === route
    );

    if (config?.children) {
      for (const child of config.children) {
        expanded.add(child.entity);
      }
    }
  }

  return Array.from(expanded);
}

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.replace("Bearer ", "").trim();
}

function getApiKeyHeaders(req: Request): {
  apiKey: string | null;
  apiSecret: string | null;
} {
  const apiKey = (req.headers["x-api-key"] as string | undefined) ?? null;
  const apiSecret = (req.headers["x-api-secret"] as string | undefined) ?? null;
  return { apiKey, apiSecret };
}

function applicationRouteAllowed(
  req: Request,
  allowedRoutes: string[]
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

async function authorizeApplication(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  application: ApplicationRequestAttributes
) {
  const rolePermissions = application.role?.permissions || [];
  const roleRoutes = getRoutesFromRole(rolePermissions);

  const mergedRoutes = [
    ...new Set([...(application.allowed_routes || []), ...roleRoutes]),
  ];

  const expandedRoutes = expandAllowedRoutes(mergedRoutes);

  // if (!applicationRouteAllowed(req, expandedRoutes)) {
  //   return res.status(403).json({
  //     error: "Rota não liberada para este aplicativo.",
  //   });
  // }

  req.application = application;
  req.user = { id: application.id, role: application.role_id };

  const rateLimit = await enforceApplicationRateLimit(req);
  if (!rateLimit.allowed) {
    return res.status(429).json(rateLimit.body);
  }

  return next();
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const { apiKey, apiSecret } = getApiKeyHeaders(req);

  // Fluxo de aplicações com ignore_token=true: autenticação via API key/secret,
  // sem passar por JWT. Se a aplicação usar esse modo, os headers são obrigatórios.
  if (apiKey || apiSecret) {
    if (!apiKey || !apiSecret) {
      return res.status(401).json({
        error: "Cabeçalhos x-api-key e x-api-secret são obrigatórios.",
      });
    }

    const application = (await applicationService.authenticateWithApiKey(
      apiKey,
      apiSecret
    )) as ApplicationRequestAttributes | null;

    if (!application) {
      return res.status(401).json({ error: "API key ou secret inválidos" });
    }

    if (!application.ignore_token) {
      return res.status(401).json({
        error: "Este aplicativo não está habilitado para autenticação via API key/secret.",
      });
    }

    return authorizeApplication(req, res, next, application);
  }

  const token = req.cookies?.token ?? getBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: "Não autenticado" });
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
          appPayload.id
        )) as ApplicationRequestAttributes | null;

      if (!application) {
        return res
          .status(401)
          .json({ error: "Aplicativo inválido ou inativo" });
      }

      if (application.ignore_token) {
        return res.status(401).json({
          error: "Este aplicativo deve se autenticar via API key/secret.",
        });
      }

      if (application.token_version !== appPayload.tokenVersion) {
        return res.status(401).json({ error: "Token de aplicativo revogado" });
      }

      return authorizeApplication(req, res, next, application);
    }

    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}