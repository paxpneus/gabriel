// ─── Tipos base do searchCriteria do Magento ──────────────────────────────────

export type MagentoConditionType =
  | "eq"
  | "neq"
  | "like"
  | "nlike"
  | "in"
  | "nin"
  | "notnull"
  | "null"
  | "gt"
  | "lt"
  | "gteq"
  | "lteq"
  | "finset";

export interface MagentoFilter {
  field: string;
  value: string | number;
  conditionType?: MagentoConditionType;
}

/** Grupo de filtros — dentro do mesmo grupo os filtros são combinados com OR */
export type MagentoFilterGroup = MagentoFilter[];

export interface MagentoSortOrder {
  field: string;
  direction: "ASC" | "DESC";
}

export interface MagentoSearchParams {
  /**
   * Grupos de filtros. Filtros dentro do mesmo grupo = OR.
   * Grupos diferentes = AND.
   *
   * Exemplo — status=1 AND (type_id=simple OR type_id=configurable):
   * filterGroups: [
   *   [{ field: "status", value: 1 }],
   *   [{ field: "type_id", value: "simple" }, { field: "type_id", value: "configurable" }],
   * ]
   */
  filterGroups?: MagentoFilterGroup[];
  sortOrders?: MagentoSortOrder[];
  pageSize?: number;
  currentPage?: number;
}

// ─── Builder principal ─────────────────────────────────────────────────────────

/**
 * Converte um objeto MagentoSearchParams no formato de query string
 * que o Magento REST API espera via searchCriteria.
 *
 * Uso:
 *   const params = buildSearchCriteria({
 *     filterGroups: [
 *       [{ field: "status", value: 1, conditionType: "eq" }],
 *       [{ field: "type_id", value: "simple" }, { field: "type_id", value: "configurable" }],
 *     ],
 *     pageSize: 20,
 *     currentPage: 1,
 *     sortOrders: [{ field: "created_at", direction: "DESC" }],
 *   });
 *   // params["searchCriteria[filter_groups][0][filters][0][field]"] = "status"
 *   // ...
 */
export function buildSearchCriteria(
  input: MagentoSearchParams = {},
): Record<string, string | number> {
  const params: Record<string, string | number> = {};

  const { filterGroups = [], sortOrders = [], pageSize, currentPage } = input;

  // Filter groups
  filterGroups.forEach((group, gi) => {
    group.forEach((filter, fi) => {
      const base = `searchCriteria[filter_groups][${gi}][filters][${fi}]`;
      params[`${base}[field]`] = filter.field;
      params[`${base}[value]`] = filter.value;
      params[`${base}[condition_type]`] = filter.conditionType ?? "eq";
    });
  });

  // Sort orders
  sortOrders.forEach((sort, si) => {
    const base = `searchCriteria[sort_orders][${si}]`;
    params[`${base}[field]`] = sort.field;
    params[`${base}[direction]`] = sort.direction;
  });

  // Pagination
  if (pageSize !== undefined) {
    params["searchCriteria[page_size]"] = pageSize;
  }
  if (currentPage !== undefined) {
    params["searchCriteria[current_page]"] = currentPage;
  }

  // Garante ao menos searchCriteria vazio para endpoints que exigem o param
  if (Object.keys(params).length === 0) {
    params["searchCriteria"] = "";
  }

  return params;
}

// ─── Helpers de uso frequente ──────────────────────────────────────────────────

/** Retorna searchCriteria para listar todos (sem filtro, com paginação opcional) */
export function buildListAll(pageSize = 100, currentPage = 1) {
  return buildSearchCriteria({ pageSize, currentPage });
}

/** Filtro simples por campo único */
export function buildFilterBy(
  field: string,
  value: string | number,
  conditionType: MagentoConditionType = "eq",
  pageSize = 100,
  currentPage = 1,
) {
  return buildSearchCriteria({
    filterGroups: [[{ field, value, conditionType }]],
    pageSize,
    currentPage,
  });
}

/** Filtro por múltiplos valores no mesmo campo (IN) */
export function buildFilterIn(
  field: string,
  values: (string | number)[],
  pageSize = 100,
  currentPage = 1,
) {
  return buildSearchCriteria({
    filterGroups: [[{ field, value: values.join(","), conditionType: "in" }]],
    pageSize,
    currentPage,
  });
}