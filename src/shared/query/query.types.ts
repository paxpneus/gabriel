// src/shared/query/query.parser.ts

import { Op, WhereOptions, OrderItem } from "sequelize";

export interface QueryParams {
  page?: number | string;
  perPage?: number | string;
  sortBy?: string | string[];
  sortDir?: string | string[];
  search?: string;
  filters?: Record<string, string | string[] | undefined>;
  dateFrom?: string;
  dateTo?: string;
  dateField?: string;
}

export type CustomFieldResolver = (value: string | string[]) => WhereOptions;

export interface QueryConfig {
  searchFields?: string[];
  filterableFields?: string[];
  sortableFields?: string[];
  stringFields?: string[];
  customFields?: Record<string, CustomFieldResolver>;
  defaults?: {
    page?: number;
    perPage?: number;
    sortBy?: string | string[];          
    sortDir?: "ASC" | "DESC" | ("ASC" | "DESC")[]; 
  };
}

export interface ResolvedQuery {
  where: WhereOptions;
  limit: number;
  offset: number;
  order: OrderItem[];
  page: number;
  perPage: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

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
