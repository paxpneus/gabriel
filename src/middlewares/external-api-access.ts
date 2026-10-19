import { Request, Response, NextFunction } from "express";
import { resolveLinkAccess } from "../modules/sales/pdv-management/pdv-access/helpers/resolve-pdv-access";
import { PdvAccessScreen } from "../modules/sales/pdv-management/pdv-access/pdv-access.types";

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") ?? [];
const PUBLIC_API_ROUTES = new Set([
  "applications/login",
  "applications/test-webhook/post",
]);
// Prefixos com auth própria (integração externa OU pdvAccess por link) — dispensam origin/cookie/bearer/api-key deste gate.
const GATE_EXEMPT_ROUTE_PREFIXES = [
  "bling",
  "bling-orders",
  "mercado_livre",
  "sales-request",
  "pdv-access",
];

function getApiPath(req: Request): string {
  return req.originalUrl
    .split("?")[0]
    .replace(/^\/api\/?/, "")
    .replace(/^\/+/, "");
}

export async function externalApiAccess(
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
  if (GATE_EXEMPT_ROUTE_PREFIXES.includes(baseSegment)) return next();
  if (req.headers.authorization?.startsWith("Bearer ")) return next();
  if (req.headers["x-api-key"] && req.headers["x-api-secret"]) return next();

  // GET de mesma origem (front via proxy) não manda Origin: link do PDV entra só com x-pdv-token
  // válido; a permissão por tela continua no pdvAccess([...]) de cada rota.
  const pdvToken = req.header("x-pdv-token");
  if (pdvToken) {
    try {
      const result = await resolveLinkAccess(
        req.header("x-pdv-unit-business-number"),
        pdvToken,
        Object.values(PdvAccessScreen),
      );
      if ("context" in result) return next();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(401).json({
    error: "Aplicativo não autenticado para acessar a API.",
  });
}
