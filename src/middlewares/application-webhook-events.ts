import { NextFunction, Request, Response } from "express";
import { ROUTE_TO_TABLE } from "../config/routes";
import applicationService from "../modules/integrations/applications/applications.service";
import {
  ApplicationWebhookEvent,
  ApplicationWebhookPayload,
} from "../modules/integrations/applications/applications.types";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EXCLUDED_RESOURCES = new Set(["applications"]);

function getApiSegments(originalUrl: string): string[] {
  const segments = originalUrl.split("?")[0].split("/").filter(Boolean);
  const apiIndex = segments.indexOf("api");
  return apiIndex === -1 ? segments : segments.slice(apiIndex + 1);
}

function resolveEvent(method: string): ApplicationWebhookEvent | null {
  if (method === "POST") return "create";
  if (method === "PUT" || method === "PATCH") return "edit";
  if (method === "DELETE") return "delete";
  return null;
}

function buildDeleteFallbackData(req: Request, segments: string[]): unknown {
  if (segments[1] === "bulk") return req.body;
  return { id: segments[1] };
}

export function applicationWebhookEvents(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!MUTATION_METHODS.has(req.method)) return next();

  const segments = getApiSegments(req.originalUrl);
  const routeSegment = segments[0];
  const event = resolveEvent(req.method);

  if (
    !event ||
    !routeSegment ||
    EXCLUDED_RESOURCES.has(routeSegment) ||
    !ROUTE_TO_TABLE[routeSegment]
  ) {
    return next();
  }

  let responseBody: unknown;
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as Response["json"];

  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    const payload: ApplicationWebhookPayload = {
      event,
      entity: ROUTE_TO_TABLE[routeSegment],
      data:
        responseBody ??
        (event === "delete" ? buildDeleteFallbackData(req, segments) : req.body),
    };

    applicationService
      .dispatchWebhookEvent(payload, routeSegment)
      .catch((error) => {
        console.error(
          `[ApplicationsWebhook] Falha ao preparar evento ${payload.event}:${payload.entity}`,
          error.message,
        );
      });
  });

  return next();
}
