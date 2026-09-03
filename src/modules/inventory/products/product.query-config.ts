import { Op } from "sequelize";
import { QueryConfig, QueryParams } from "../../../shared/query/query.types";

export const productQueryConfig: QueryConfig = {
  defaults: {
    perPage: 20,
    sortBy: ["created_at", "name"],
    sortDir: "DESC",
  },
  searchFields: [
    "name",
    "$productConfigs.sku$",
    "$productConfigs.gtin$",
  ],
  filterableFields: ["type"],
  customFields: {
    sku: (value) => ({
      "$productConfigs.sku$": value,
    }),
    gtin: (value) => ({
      "$productConfigs.gtin$": value,
    }),
    subgroup_id: (value) => ({
      "$subgroup.id$": value,
    }),
    group_id: (value) => ({
      "$subgroup.group_id$": value,
    }),
    brand_id: (value) => ({
      "$brandRegister.id$": value,
    }),
    rim: (value) => ({
      "$rimRegister.value$": Array.isArray(value)
        ? { [Op.in]: value }
        : value,
    }),
    measure: (value) => ({
      "$measureRegister.value$": Array.isArray(value)
        ? { [Op.in]: value }
        : value,
    }),
  },
};

type StockUnitFilter = {
  unitBusinessId?: string;
  stockUnit?: "positive" | "zero";
};

export function extractStockFilter(params: QueryParams): {
    stockFilter?: StockUnitFilter;
    stockWhere: Record<string, unknown>;
    paramsWithoutStockFilter: QueryParams;
  } {
    const stockFilter =
      params.filters?.stockUnit &&
      typeof params.filters.stockUnit === "object" &&
      !Array.isArray(params.filters.stockUnit)
        ? (params.filters.stockUnit as StockUnitFilter)
        : undefined;

    const stockWhere: Record<string, unknown> = {};

    if (stockFilter?.unitBusinessId) {
      stockWhere.unit_business_id = stockFilter.unitBusinessId;
    }

    if (stockFilter?.stockUnit) {
      stockWhere.quantity =
        stockFilter.stockUnit === "positive" ? { [Op.gt]: 0 } : { [Op.lte]: 0 };
    }

    const filters = { ...params.filters };
    delete filters.stockUnit;

    return {
      stockFilter,
      stockWhere,
      paramsWithoutStockFilter: {
        ...params,
        filters: Object.keys(filters).length ? filters : undefined,
      },
    };
  }