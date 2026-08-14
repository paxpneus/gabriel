// src/modules/product/helpers/last-movement-date-filter.ts
import { literal, Op, WhereOptions } from "sequelize";
import { QueryParams } from "../../../../shared/query/query.types";
import { LastMovementDateRangeDate, LastMovementDateRangeFilter } from "../product.types";

function parseStartOfDay(rawValue: unknown): Date | undefined {
  if (!rawValue || typeof rawValue !== "string") return undefined;

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawValue);
  const normalized = isDateOnly ? `${rawValue}T00:00:00.000Z` : rawValue;

  const parsed = new Date(normalized);
  return !isNaN(parsed.getTime()) ? parsed : undefined;
}

function parseEndOfDay(rawValue: unknown): Date | undefined {
  if (!rawValue || typeof rawValue !== "string") return undefined;

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawValue);
  const normalized = isDateOnly ? `${rawValue}T23:59:59.999Z` : rawValue;

  const parsed = new Date(normalized);
  return !isNaN(parsed.getTime()) ? parsed : undefined;
}

/**
 * Extrai o filtro de "última movimentação" (range) de params.filters.lastMovementDate.
 * Se só vier `start`, o filtro vira "naquele dia mesmo" (start 00:00 -> start 23:59).
 */
export function extractLastMovementDateFilter(params: QueryParams): {
  lastMovementRange?: LastMovementDateRangeDate;
  paramsWithoutDateFilter: QueryParams;
} {
  const raw = params.filters?.lastMovementDate;

  let start: Date | undefined;
  let end: Date | undefined;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const { start: rawStart, end: rawEnd } = raw as LastMovementDateRangeDate;

    start = parseStartOfDay(rawStart);
    end = rawEnd
      ? parseEndOfDay(rawEnd)
      : rawStart
        ? parseEndOfDay(rawStart) // só start -> filtra só aquele dia
        : undefined;
  }

  const filters = { ...params.filters };
  delete filters.lastMovementDate;

  return {
    lastMovementRange: start || end ? { start, end } : undefined,
    paramsWithoutDateFilter: {
      ...params,
      filters: Object.keys(filters).length ? filters : undefined,
    },
  };
}

/**
 * Subquery da última movimentação "efetiva" (PURCHASE_ENTRY ou
 * MANUAL_ADJUSTMENT com custo) do produto, opcionalmente truncada por um
 * cutoff (`asOfDate`).
 *
 * IMPORTANTE: Este subquery NÃO usa Sequelize replacements. Os valores
 * devem ser interpolados já na string (via template literal).
 */
export function buildLastMovementDateSubquery(
  unitBusinessId?: string,
  asOfDate?: Date,
): string {
  const asOfDateClause = asOfDate
    ? `AND sm.movement_date <= '${asOfDate.toISOString()}'`
    : "";

  return `(
    SELECT MAX(sm.movement_date)
    FROM stock_movements sm
    WHERE sm.product_id = "Product"."id"
      AND sm.is_active = true
      AND (
        sm.movement_type = 'PURCHASE_ENTRY'
        OR (sm.movement_type = 'MANUAL_ADJUSTMENT' AND sm.manual_average_cost_value IS NOT NULL)
      )
      ${unitBusinessId ? "AND sm.unit_business_id = :orderUnitBusinessId" : ""}
      ${asOfDateClause}
  )`;
}

/**
 * Ordenação pela última movimentação efetiva "atual" (sem cutoff) — usada
 * na listagem normal, quando não há filtro de range.
 */
export function buildLastMovementDateOrder(unitBusinessId?: string) {
  return literal(`${buildLastMovementDateSubquery(unitBusinessId)} DESC NULLS LAST`);
}

/**
 * Monta a condição WHERE do filtro de range.
 *
 * Regra: `end` funciona como cutoff — recalcula qual é a última
 * movimentação efetiva do produto considerando só o que aconteceu até
 * `end` (ignora tudo depois). Essa última movimentação recalculada
 * precisa ter data >= `start` pra o produto entrar no resultado.
 *
 * Se só vier `start` (sem end explícito), o parser já preenche `end` como
 * o fim daquele mesmo dia — então o efeito é "última movimentação efetiva
 * daquele dia específico".
 */
export function buildLastMovementRangeWhere(
  range: LastMovementDateRangeDate | undefined,
  unitBusinessId?: string,
): WhereOptions | undefined {
  if (!range || (!range.start && !range.end)) return undefined;

  // usa `end` como cutoff da subquery
  const subquery = buildLastMovementDateSubquery(unitBusinessId, range.end);

  if (range.start) {
    return literal(
      `${subquery} >= '${range.start.toISOString()}'`,
    ) as unknown as WhereOptions;
  }

  // só end, sem start (caso raro, mas suportado): só garante que existe
  // alguma movimentação efetiva até aquela data
  return literal(`${subquery} IS NOT NULL`) as unknown as WhereOptions;
}
