import { Request, Response, NextFunction } from "express";

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") ?? [];
const PUBLIC_API_ROUTES = new Set(["applications/login"]);
const EXTERNAL_ROUTE_PREFIXES = ["bling", "bling-orders"];

function getApiPath(req: Request): string {
  return req.originalUrl
    .split("?")[0]
    .replace(/^\/api\/?/, "")
    .replace(/^\/+/, "");
}

export function externalApiAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const origin = req.headers.origin;
  const apiPath = getApiPath(req);
  const baseSegment = apiPath.split("/")[0];

  if (origin && allowedOrigins.includes(origin)) return next();
  if (req.cookies?.token) return next();
  if (PUBLIC_API_ROUTES.has(apiPath)) return next();
  if (EXTERNAL_ROUTE_PREFIXES.includes(baseSegment)) return next();
  if (req.headers.authorization?.startsWith("Bearer ")) return next();

  return res.status(401).json({
    error: "Aplicativo não autenticado para acessar a API.",
  });
}

