import { Request } from "express";

// Helpers de request das rotas de nota (unit business vinda de params/query/filters), usados por vários controllers.

// filters[unit_business_id] também é lido aqui — antes só valia
// ?unitBusinessId=, e ter os dois convivendo sem se sobrepor causava um
// AND impossível entre esse escopo e o customField unit_business_id do
// queryConfig (mesmo campo, valores diferentes = zero resultados).
export function extractUnitBusinessIdFromRequest(req: Request): string | undefined {
  const filtersUnitBusinessId = (
    req.query.filters as Record<string, unknown> | undefined
  )?.unit_business_id;

  const fromParams = (req.params.unitBusinessId ??
    req.query.unitBusinessId ??
    (typeof filtersUnitBusinessId === "string"
      ? filtersUnitBusinessId
      : undefined)) as string | undefined;

  return fromParams && fromParams.trim() ? fromParams : undefined;
}

export function resolveUnitBusinessId(
  req: Request,
  contextUnitBusinessId: string,
): string {
  return extractUnitBusinessIdFromRequest(req) ?? contextUnitBusinessId;
}
