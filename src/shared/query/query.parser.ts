// src/shared/query/query.parser.ts

import {
  Op,
  WhereOptions,
  OrderItem,
  where as sequelizeWhere,
  literal,
  cast,
  col,
} from "sequelize";
import type { QueryParams, ResolvedQuery, QueryConfig } from "./query.types";

const DEFAULTS = {
  page: 1,
  perPage: 20,
  sortBy: "createdAt",
  sortDir: "DESC" as const,
};

export class QueryParser {
  /**
   * Converte os query params da request em opções prontas para o Sequelize.
   *
   * @param params  - req.query (ou objeto manual)
   * @param config  - configuração da entidade (campos permitidos, defaults)
   */
  static parse(params: QueryParams, config: QueryConfig = {}): ResolvedQuery {
    const defaults = { ...DEFAULTS, ...config.defaults };

    // ── Paginação ──────────────────────────────────────────────────────────
    const page = Math.max(1, Number(params.page) || defaults.page);
    const perPage = Math.max(1, Number(params.perPage) || defaults.perPage);
    const offset = (page - 1) * perPage;

    // ── Ordenação ──────────────────────────────────────────────────────────
    const rawSortBy = params.sortBy ?? defaults.sortBy;
    const rawSortDir = params.sortDir ?? defaults.sortDir;

    const sortByList = Array.isArray(rawSortBy)
      ? rawSortBy
      : rawSortBy.split(",").map((s) => s.trim());

    const sortDirList = Array.isArray(rawSortDir)
      ? rawSortDir
      : String(rawSortDir)
          .split(",")
          .map((s) => s.trim().toUpperCase());

    const fallbackSortBy = Array.isArray(defaults.sortBy)
      ? defaults.sortBy[0]
      : (defaults.sortBy ?? DEFAULTS.sortBy);

    const order: OrderItem[] = sortByList.map((field, i) => {
      const dir = (
        ["ASC", "DESC"].includes(sortDirList[i] ?? "")
          ? sortDirList[i]
          : (sortDirList[0] ?? defaults.sortDir)
      ) as "ASC" | "DESC";

      if (config.customSort?.[field]) {
        return config.customSort[field](dir);
      }

      const allowed = config.sortableFields;
      const resolvedField: string =
        allowed?.length && !allowed.includes(field) ? fallbackSortBy : field;

      return [resolvedField, dir] as [string, "ASC" | "DESC"];
    });

    // ── Where ──────────────────────────────────────────────────────────────
    const conditions: WhereOptions[] = [];

    const where: any = {};

    // 1. Filtros por campo exato (filters[key]=value ou filters[key][]=v1&filters[key][]=v2)
    if (params.filters) {
      for (const [field, value] of Object.entries(params.filters)) {
        if (config.customFields?.[field]) {
          const cleanedValue = Array.isArray(value)
            ? value.filter((v) => v !== undefined && v !== null && v !== "")
            : value;

          if (
            cleanedValue &&
            !(Array.isArray(cleanedValue) && cleanedValue.length === 0)
          ) {
            const resolved = config.customFields[field](
              cleanedValue as string | string[],
            );
            Object.assign(where, resolved);
          }
          continue;
        }

        if (
          config.filterableFields?.length &&
          !config.filterableFields.includes(field)
        )
          continue;

        if (value === undefined || value === null || value === "") continue;

        if (Array.isArray(value) && value.length === 0) continue;

        if (
          typeof value === "object" &&
          value !== null &&
          ("start" in value || "end" in value)
        ) {
          const { start, end } = value as any;

          if (field === "emitted_at") {
            const emittedAtRange: Record<symbol, any> = {};

            if (start) {
              emittedAtRange[Op.gte] = literal(
                `('${start}'::date AT TIME ZONE 'America/Sao_Paulo')`,
              );
            }

            if (end) {
              emittedAtRange[Op.lt] = literal(
                `(('${end}'::date + INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo')`,
              );
            }

            where[Op.and] = [
              ...(where[Op.and] ?? []),
              sequelizeWhere(literal(`"emitted_at"`), emittedAtRange),
            ];
            continue;
          }

          where[field] = {
            ...(start ? { [Op.gte]: new Date(start) } : {}),
            ...(end
              ? {
                  [Op.lte]: new Date(new Date(end).setHours(23, 59, 59, 999)),
                }
              : {}),
          };

          continue;
        }

        const dateFields = ["emitted_at", "createdAt", "updatedAt"];

        if (
          dateFields.includes(field) &&
          typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(value)
        ) {
          if (field === "emitted_at") {
            where[Op.and] = [
              ...(where[Op.and] ?? []),
              sequelizeWhere(literal(`"emitted_at"`), {
                [Op.gte]: literal(
                  `('${value}'::date AT TIME ZONE 'America/Sao_Paulo')`,
                ),
              }),
            ];
            continue;
          }

          where[field] = {
            [Op.gte]: new Date(value + "T00:00:00"),
            [Op.lte]: new Date(value + "T23:59:59.999"),
          };
          continue;
        }

        let normalizedValue: any = value;

        // boolean string fix
        if (value === "true") normalizedValue = true;
        if (value === "false") normalizedValue = false;

        // number fix
        if (
          !config.stringFields?.includes(field) &&
          !isNaN(Number(value)) &&
          value !== ""
        ) {
          normalizedValue = Number(value);
        }

        where[field] = normalizedValue;
      }
    }

    // 2. Date range

    if (params.dateFrom || params.dateTo) {
      const dateField = params.dateField ?? "createdAt";

      where[dateField] = {
        ...(where[dateField] || {}),
        ...(params.dateFrom ? { [Op.gte]: new Date(params.dateFrom) } : {}),
        ...(params.dateTo
          ? {
              [Op.lte]: new Date(
                new Date(params.dateTo).setHours(23, 59, 59, 999),
              ),
            }
          : {}),
      };
    }

    // 3. Search global (ILIKE nos campos configurados)
    if (params.search?.trim()) {
  if (!config.searchFields?.length) {
    where.id = null;
  } else {
    const term = `%${params.search.trim()}%`;

    where[Op.or] = config.searchFields.map((field) => {
      // Campos numéricos precisam de cast para texto antes do ILIKE
      const isNumeric = config.numericSearchFields?.includes(field);

      if (isNumeric) {
        return sequelizeWhere(cast(col(field), "text"), {
          [Op.iLike]: term,
        });
      }

      return { [field]: { [Op.iLike]: term } };
    });
  }
}

    return { limit: perPage, offset, order, where, page, perPage };
  }

  /**
   * Monta o meta de paginação a partir do total retornado pelo count.
   */
  static buildMeta(total: number, page: number, perPage: number) {
    const totalPages = Math.ceil(total / perPage) || 1;
    return {
      total,
      page,
      perPage,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }
}
