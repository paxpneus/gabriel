// src/shared/query/query.parser.ts

import { Op, WhereOptions, OrderItem } from 'sequelize'
import type { QueryParams, ResolvedQuery, QueryConfig } from './query.types'

const DEFAULTS = {
  page: 1,
  perPage: 20,
  sortBy: 'createdAt',
  sortDir: 'DESC' as const,
}

export class QueryParser {
  /**
   * Converte os query params da request em opções prontas para o Sequelize.
   *
   * @param params  - req.query (ou objeto manual)
   * @param config  - configuração da entidade (campos permitidos, defaults)
   */
  static parse(params: QueryParams, config: QueryConfig = {}): ResolvedQuery {
    const defaults = { ...DEFAULTS, ...config.defaults }

    // ── Paginação ──────────────────────────────────────────────────────────
    const page    = Math.max(1, Number(params.page)    || defaults.page)
    const perPage = Math.max(1, Number(params.perPage) || defaults.perPage)
    const offset  = (page - 1) * perPage

    // ── Ordenação ──────────────────────────────────────────────────────────
    const requestedSort = params.sortBy ?? defaults.sortBy
    const sortBy = config.sortableFields?.length
      ? config.sortableFields.includes(requestedSort) ? requestedSort : defaults.sortBy
      : requestedSort  // sem whitelist → aceita qualquer campo

    const sortDir = (['ASC', 'DESC'].includes((params.sortDir ?? '').toUpperCase())
      ? params.sortDir!.toUpperCase()
      : defaults.sortDir) as 'ASC' | 'DESC'

    const order: OrderItem[] = [[sortBy, sortDir]]

    // ── Where ──────────────────────────────────────────────────────────────
    const conditions: WhereOptions[] = []

    // 1. Filtros por campo exato (filters[key]=value ou filters[key][]=v1&filters[key][]=v2)
    if (params.filters) {
      for (const [field, value] of Object.entries(params.filters)) {
        // Whitelist guard
        if (config.filterableFields?.length && !config.filterableFields.includes(field)) continue
        if (!value || (Array.isArray(value) && value.length === 0)) continue

        if (Array.isArray(value)) {
          conditions.push({ [field]: { [Op.in]: value } } as WhereOptions)
        } else {
          conditions.push({ [field]: value } as WhereOptions)
        }
      }
    }

    // 2. Date range
    if (params.dateFrom || params.dateTo) {
      const dateField = params.dateField ?? 'createdAt'
      const rangeCondition: Record<symbol, Date> = {}

      if (params.dateFrom) rangeCondition[Op.gte] = new Date(params.dateFrom)
      if (params.dateTo) {
        // Inclui o dia inteiro do dateTo
        const to = new Date(params.dateTo)
        to.setHours(23, 59, 59, 999)
        rangeCondition[Op.lte] = to
      }

      conditions.push({ [dateField]: rangeCondition } as WhereOptions)
    }

    // 3. Search global (ILIKE nos campos configurados)
    if (params.search?.trim()) {
  if (!config.searchFields?.length) {
    conditions.push({ id: null } as WhereOptions)
  } else {
    const term = `%${params.search.trim()}%`
    const orConditions = config.searchFields.map(field => ({
      [field]: { [Op.iLike]: term },
    }))
    conditions.push({ [Op.or]: orConditions } as WhereOptions)
  }
}

    const where: WhereOptions = conditions.length > 1
      ? { [Op.and]: conditions }
      : conditions[0] ?? {}

    return { limit: perPage, offset, order, where, page, perPage }
  }

  /**
   * Monta o meta de paginação a partir do total retornado pelo count.
   */
  static buildMeta(total: number, page: number, perPage: number) {
    const totalPages = Math.ceil(total / perPage) || 1
    return {
      total,
      page,
      perPage,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    }
  }
}