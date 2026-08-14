import { FindOptions, literal, Op, WhereOptions } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import {
  QueryConfig,
  QueryParams,
  PaginatedResult,
} from "../../../../shared/query/query.types";
import { QueryParser } from "../../../../shared/query/query.parser";
import Product from "../product.model";
import Stock from "../../stock/stock/stock.model";
import ProductConfig from "../../product-config/product_config.model";
import Group from "../../groups/group/group.model";
import Subgroup from "../../groups/subgroup/subgroup.model";
import Brand from "../../brands/brands.model";
import { StockMovementRepository } from "../../stock/stock-movements/stock-movements.repository";
import defaultStockMovementRepository from "../../stock/stock-movements/stock-movements.repository";
import {
  AverageCostTrend,
  ProductDetailedWithMovements,
} from "../product.types";
import { computeAverageCostTrend } from "../helpers/product-cost-trend";
import { extractStockFilter } from "../product.query-config";

type StockUnitFilter = {
  unitBusinessId?: string;
  stockUnit?: "positive" | "zero";
};

export class ProductWithMovementsRepository extends BaseRepository<Product> {
  constructor(
    private readonly stockMovementRepository: StockMovementRepository = defaultStockMovementRepository,
  ) {
    super(Product);
  }

  private extractLastMovementDateFilter(params: QueryParams): {
    asOfDate?: Date;
    paramsWithoutDateFilter: QueryParams;
  } {
    const raw = params.filters?.lastMovementDate;
    const rawValue = Array.isArray(raw) ? raw[0] : raw;

    const parsed = rawValue ? new Date(rawValue) : undefined;
    const asOfDate = parsed && !isNaN(parsed.getTime()) ? parsed : undefined;

    const filters = { ...params.filters };
    delete filters.lastMovementDate;

    return {
      asOfDate,
      paramsWithoutDateFilter: {
        ...params,
        filters: Object.keys(filters).length ? filters : undefined,
      },
    };
  }

  private extractAverageCostTrendFilter(params: QueryParams): {
    trendFilter?: AverageCostTrend[];
    paramsWithoutTrendFilter: QueryParams;
  } {
    const raw = params.filters?.average_cost_trend;
    const trendFilter = raw
      ? ((Array.isArray(raw) ? raw : [raw]) as AverageCostTrend[])
      : undefined;

    const filters = { ...params.filters };
    delete filters.average_cost_trend;

    return {
      trendFilter,
      paramsWithoutTrendFilter: {
        ...params,
        filters: Object.keys(filters).length ? filters : undefined,
      },
    };
  }

  private async resolveTrendFilterProductIds(
    params: QueryParams,
    queryConfig: QueryConfig,
    stockWhere: Record<string, unknown>,
    stockFilter: StockUnitFilter | undefined,
    unitBusinessId: string | undefined,
    asOfDate: Date | undefined,
    trendFilter: AverageCostTrend[],
  ): Promise<string[]> {
    if (!unitBusinessId) return [];

    const resolved = QueryParser.parse(params, queryConfig);

    const candidates = await this.model.findAll({
      subQuery: false,
      attributes: ["id"],
      where: resolved.where as WhereOptions,
      include: [
        {
          model: Stock,
          as: "stocks",
          where: Object.keys(stockWhere).length ? stockWhere : undefined,
          required: !!stockFilter?.stockUnit,
          attributes: [],
        },
        {
          model: ProductConfig,
          as: "productConfigs",
          where: stockFilter?.unitBusinessId
            ? { unit_business_id: stockFilter.unitBusinessId }
            : undefined,
          required: false,
          attributes: [],
        },
      ],
    });

    const productIds = candidates.map((p) => p.id);
    if (!productIds.length) return [];

    const lastEntriesByProduct =
      await this.stockMovementRepository.findLastPurchaseEntries(
        productIds,
        unitBusinessId,
        asOfDate,
        2,
      );

    return productIds.filter((id) =>
      trendFilter.includes(
        computeAverageCostTrend(lastEntriesByProduct.get(id) ?? []),
      ),
    );
  }

  /**
   * Igual ao original: usa this.findPaginated, herdado de BaseRepository —
   * não reimplementa paginação.
   */
  async paginateDetailedWithMovements(
    params: QueryParams,
    queryConfig: QueryConfig,
    unitBusinessId?: string,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<ProductDetailedWithMovements>> {
    const { stockFilter, stockWhere, paramsWithoutStockFilter } =
      extractStockFilter(params);

    const { asOfDate, paramsWithoutDateFilter } =
      this.extractLastMovementDateFilter(paramsWithoutStockFilter);

    const { trendFilter, paramsWithoutTrendFilter } =
      this.extractAverageCostTrendFilter(paramsWithoutDateFilter);

    const resolvedUnitBusinessId =
      unitBusinessId ?? stockFilter?.unitBusinessId;

    const trendProductIds = trendFilter?.length
      ? await this.resolveTrendFilterProductIds(
          paramsWithoutTrendFilter,
          queryConfig,
          stockWhere,
          stockFilter,
          resolvedUnitBusinessId,
          asOfDate,
          trendFilter,
        )
      : undefined;

    if (trendFilter?.length && trendProductIds?.length === 0) {
      return {
        data: [],
        meta: QueryParser.buildMeta(
          0,
          (params.page as number) ?? 1,
          (params.perPage as number) ?? queryConfig.defaults?.perPage ?? 20,
        ),
      };
    }

    const lastMovementDateOrder = literal(`(
    SELECT MAX(sm.movement_date)
    FROM stock_movements sm
    WHERE sm.product_id = "Product"."id"
      AND sm.is_active = true
      AND (
        sm.movement_type = 'PURCHASE_ENTRY'
        OR (sm.movement_type = 'MANUAL_ADJUSTMENT' AND sm.manual_average_cost_value IS NOT NULL)
      )
      ${resolvedUnitBusinessId ? "AND sm.unit_business_id = :orderUnitBusinessId" : ""}
      ${asOfDate ? "AND sm.movement_date <= :asOfDate" : ""}
  ) DESC NULLS LAST`);

    const result = await this.findPaginated<ProductDetailedWithMovements>(
      paramsWithoutTrendFilter,
      queryConfig,
      {
        ...extraOptions,
        subQuery: false,
        attributes: { exclude: ["source_payload"] },
        replacements: {
          ...(resolvedUnitBusinessId
            ? { orderUnitBusinessId: resolvedUnitBusinessId }
            : {}),
          ...(asOfDate ? { asOfDate: asOfDate.toISOString() } : {}),
        },
        include: [
          {
            model: Stock,
            as: "stocks",
            where: Object.keys(stockWhere).length ? stockWhere : undefined,
            required: !!stockFilter?.stockUnit,
            attributes: ["id", "quantity", "unit_business_id", "total_price"],
          },
          {
            model: Subgroup,
            as: "subgroup",
            include: [{ model: Group, as: "group" }],
          },
          {
            model: Brand,
            as: "brandRegister",
            required: false,
          },
          {
            model: ProductConfig,
            as: "productConfigs",
            where: resolvedUnitBusinessId
              ? { unit_business_id: resolvedUnitBusinessId }
              : undefined,
            required: false,
          },
        ],
      },
      trendProductIds ? { id: { [Op.in]: trendProductIds } } : undefined,
      [lastMovementDateOrder],
    );

    if (resolvedUnitBusinessId && result.data.length) {
      await this.attachStockCostInfo(
        result.data,
        resolvedUnitBusinessId,
        asOfDate,
      );
    }

    return result;
  }

  /**
   * Não-paginado (relatório) — continua usando this.model.findAll direto,
   * igual ao original, já que não passa por findPaginated.
   */
  async findAllDetailedWithMovements(
    params: QueryParams,
    queryConfig: QueryConfig,
    unitBusinessId?: string,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<ProductDetailedWithMovements[]> {
    const { stockFilter, stockWhere, paramsWithoutStockFilter } =
      extractStockFilter(params);

    const resolvedUnitBusinessId =
      unitBusinessId ?? stockFilter?.unitBusinessId;

    const { asOfDate, paramsWithoutDateFilter } =
      this.extractLastMovementDateFilter(paramsWithoutStockFilter);

    const { trendFilter, paramsWithoutTrendFilter } =
      this.extractAverageCostTrendFilter(paramsWithoutDateFilter);

    const trendProductIds = trendFilter?.length
      ? await this.resolveTrendFilterProductIds(
          paramsWithoutTrendFilter,
          queryConfig,
          stockWhere,
          stockFilter,
          resolvedUnitBusinessId,
          asOfDate,
          trendFilter,
        )
      : undefined;

    if (trendFilter?.length && trendProductIds?.length === 0) {
      return [];
    }

    const lastMovementDateOrder = literal(`(
    SELECT MAX(sm.movement_date)
    FROM stock_movements sm
    WHERE sm.product_id = "Product"."id"
      AND sm.is_active = true
      AND (
        sm.movement_type = 'PURCHASE_ENTRY'
        OR (sm.movement_type = 'MANUAL_ADJUSTMENT' AND sm.manual_average_cost_value IS NOT NULL)
      )
      ${resolvedUnitBusinessId ? "AND sm.unit_business_id = :orderUnitBusinessId" : ""}
      ${asOfDate ? "AND sm.movement_date <= :asOfDate" : ""}
  ) DESC NULLS LAST`);

    const resolved = QueryParser.parse(paramsWithoutTrendFilter, queryConfig);

    const finalWhere = trendProductIds
      ? ({
          [Op.and]: [resolved.where, { id: { [Op.in]: trendProductIds } }],
        } as WhereOptions)
      : (resolved.where as WhereOptions);

    const products = (await this.model.findAll({
      subQuery: false,
      attributes: { exclude: ["source_payload"] },
      ...extraOptions,
      where: finalWhere,
      order: [lastMovementDateOrder],
      replacements: {
        ...(resolvedUnitBusinessId
          ? { orderUnitBusinessId: resolvedUnitBusinessId }
          : {}),
        ...(asOfDate ? { asOfDate: asOfDate.toISOString() } : {}),
      },
      include: [
        {
          model: Stock,
          as: "stocks",
          where: Object.keys(stockWhere).length ? stockWhere : undefined,
          required: !!stockFilter?.stockUnit,
          attributes: ["id", "quantity", "unit_business_id", "total_price"],
        },
        {
          model: Subgroup,
          as: "subgroup",
          include: [{ model: Group, as: "group" }],
        },
        {
          model: Brand,
          as: "brandRegister",
          required: false,
        },
        {
          model: ProductConfig,
          as: "productConfigs",
          where: resolvedUnitBusinessId
            ? { unit_business_id: resolvedUnitBusinessId }
            : undefined,
          required: false,
        },
      ],
    })) as unknown as ProductDetailedWithMovements[];

    if (resolvedUnitBusinessId && products.length) {
      await this.attachStockCostInfo(
        products,
        resolvedUnitBusinessId,
        asOfDate,
      );
    }

    return products;
  }

  private async attachStockCostInfo(
    products: Product[],
    unitBusinessId: string,
    asOfDate?: Date,
  ): Promise<void> {
    const productIds = products.map((p) => p.id);

    const [lastEntriesByProduct, lastMovementByProduct] = await Promise.all([
      this.stockMovementRepository.findLastPurchaseEntries(
        productIds,
        unitBusinessId,
        asOfDate,
        2,
      ),
      this.stockMovementRepository.findLastMovementsByProducts(
        productIds,
        unitBusinessId,
        asOfDate,
      ),
    ]);

    for (const product of products) {
      const lastMovement = lastMovementByProduct.get(product.id);

      product.setDataValue(
        "lastPurchaseEntries" as any,
        lastEntriesByProduct.get(product.id) ?? [],
      );
      product.setDataValue(
        "currentAverageCost" as any,
        lastMovement ? Number(lastMovement.resulting_average_cost) : null,
      );
    }
  }
}

export default new ProductWithMovementsRepository();
