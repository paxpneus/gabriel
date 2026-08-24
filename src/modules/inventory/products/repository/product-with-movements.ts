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
  LastMovementDateRangeFilter,
  ProductDetailedWithMovements,
  StockUnitFilter,
} from "../product.types";
import { computeAverageCostTrend } from "../helpers/product-cost-trend";
import { extractStockFilter } from "../product.query-config";
import {
  buildLastMovementDateSubquery,
  buildLastMovementRangeWhere,
  extractLastMovementDateFilter,
} from "../helpers/product-movement-date";
import Rim from "../../rims/rim.model";
import TireMeasure from "../../tire-measures/tire-measure.model";

export class ProductWithMovementsRepository extends BaseRepository<Product> {
  constructor(
    private readonly stockMovementRepository: StockMovementRepository = defaultStockMovementRepository,
  ) {
    super(Product);
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
          model: Brand,
          as: "brandRegister",
          required: false,
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
      await this.stockMovementRepository.findLastEffectiveMovements(
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

    const { lastMovementRange, paramsWithoutDateFilter } =
      extractLastMovementDateFilter(paramsWithoutStockFilter);

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
          lastMovementRange?.end,
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

    const lastMovementDateOrder = literal(
      `${buildLastMovementDateSubquery(resolvedUnitBusinessId)} DESC NULLS LAST`,
    );

    const rangeWhere = buildLastMovementRangeWhere(
      lastMovementRange,
      resolvedUnitBusinessId,
    );

    const extraWhereConditions: WhereOptions[] = [];
    if (trendProductIds) {
      extraWhereConditions.push({ id: { [Op.in]: trendProductIds } });
    }
    if (rangeWhere) {
      extraWhereConditions.push(rangeWhere);
    }
    const extraWhere = extraWhereConditions.length
      ? ({ [Op.and]: extraWhereConditions } as WhereOptions)
      : undefined;

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
            model: Rim,
            as: "rimRegister",
            required: false,
          },
          {
            model: TireMeasure,
            as: "measureRegister",
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
      extraWhere,
      [lastMovementDateOrder],
    );

    if (resolvedUnitBusinessId && result.data.length) {
      await this.attachStockCostInfo(
        result.data,
        resolvedUnitBusinessId,
        lastMovementRange?.end,
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

    const { lastMovementRange, paramsWithoutDateFilter } =
      extractLastMovementDateFilter(paramsWithoutStockFilter);

    const { trendFilter, paramsWithoutTrendFilter } =
      this.extractAverageCostTrendFilter(paramsWithoutDateFilter);

    const trendProductIds = trendFilter?.length
      ? await this.resolveTrendFilterProductIds(
          paramsWithoutTrendFilter,
          queryConfig,
          stockWhere,
          stockFilter,
          resolvedUnitBusinessId,
          undefined,
          trendFilter,
        )
      : undefined;

    if (trendFilter?.length && trendProductIds?.length === 0) {
      return [];
    }

    const lastMovementDateOrder = literal(
      `${buildLastMovementDateSubquery(resolvedUnitBusinessId)} DESC NULLS LAST`,
    );

    const rangeWhere = buildLastMovementRangeWhere(
      lastMovementRange,
      resolvedUnitBusinessId,
    );

    const resolved = QueryParser.parse(paramsWithoutTrendFilter, queryConfig);

    const whereConditions: WhereOptions[] = [resolved.where as WhereOptions];
    if (trendProductIds) {
      whereConditions.push({ id: { [Op.in]: trendProductIds } });
    }
    if (rangeWhere) {
      whereConditions.push(rangeWhere);
    }

    const finalWhere = { [Op.and]: whereConditions } as WhereOptions;

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
        ...(lastMovementRange?.start
          ? { lastMovementStart: lastMovementRange.start.toISOString() }
          : {}),
        ...(lastMovementRange?.end
          ? { lastMovementEnd: lastMovementRange.end.toISOString() }
          : {}),
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
          model: Rim,
          as: "rimRegister",
          required: false,
        },
        {
          model: TireMeasure,
          as: "measureRegister",
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
        lastMovementRange?.end,
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
      this.stockMovementRepository.findLastEffectiveMovements(
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
