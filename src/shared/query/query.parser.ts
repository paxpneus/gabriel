// src/shared/query/query.parser.ts

import { Op, WhereOptions, OrderItem } from "sequelize";
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
    const requestedSort = params.sortBy ?? defaults.sortBy;
    const sortBy = config.sortableFields?.length
      ? config.sortableFields.includes(requestedSort)
        ? requestedSort
        : defaults.sortBy
      : requestedSort; // sem whitelist → aceita qualquer campo

    const sortDir = (
      ["ASC", "DESC"].includes((params.sortDir ?? "").toUpperCase())
        ? params.sortDir!.toUpperCase()
        : defaults.sortDir
    ) as "ASC" | "DESC";

    const order: OrderItem[] = [[sortBy, sortDir]];

    // ── Where ──────────────────────────────────────────────────────────────
    const conditions: WhereOptions[] = [];

    const where: any = {};

    // 1. Filtros por campo exato (filters[key]=value ou filters[key][]=v1&filters[key][]=v2)
    if (params.filters) {
      for (const [field, value] of Object.entries(params.filters)) {
        if (
          config.filterableFields?.length &&
          !config.filterableFields.includes(field)
        )
          continue;

        if (value === undefined || value === null || value === "") continue;

        if (Array.isArray(value) && value.length === 0) continue;

        let normalizedValue: any = value;

        // boolean string fix
        if (value === "true") normalizedValue = true;
        if (value === "false") normalizedValue = false;

        // number fix
        if (!isNaN(Number(value)) && value !== "") {
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

        where[Op.or] = config.searchFields.map((field) => ({
          [field]: { [Op.iLike]: term },
        }));
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
