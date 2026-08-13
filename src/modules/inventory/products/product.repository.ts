import { FindOptions, literal, Op, WhereOptions } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import {
  QueryConfig,
  QueryParams,
  PaginatedResult,
} from "../../../shared/query/query.types";
import { QueryParser } from "../../../shared/query/query.parser";
import Product from "./product.model";
import Stock from "../stock/stock/stock.model";
import ProductConfig from "../product-config/product_config.model";
import Group from "../groups/group/group.model";
import Subgroup from "../groups/subgroup/subgroup.model";
import Brand from "../brands/brands.model";
import StockMovement from "../stock/stock-movements/stock-movements.model";
import stockMovementRepository from "../stock/stock-movements/stock-movements.repository";
import { ProductDetailedWithMovements } from "./product.types";

type StockUnitFilter = {
  unitBusinessId?: string;
  stockUnit?: "positive" | "zero";
};

export class ProductRepository extends BaseRepository<Product> {
  constructor() {
    super(Product);
  }

  async findByIdWithRelations(
    id: string,
    unitBusinessId?: string,
    options?: FindOptions,
  ): Promise<Product | null> {
    return this.findById(id, {
      ...options,
      attributes: { exclude: ["source_payload"] },
      include: [
        {
          model: Stock,
          as: "stocks",
          where: unitBusinessId
            ? { unit_business_id: unitBusinessId }
            : undefined,
          required: false,
          attributes: ["id", "quantity", "unit_business_id", "total_price"],
        },
        {
          model: ProductConfig,
          as: "productConfigs",
          where: unitBusinessId
            ? { unit_business_id: unitBusinessId }
            : undefined,
          required: false,
        },
      ],
    });
  }

  private extractStockFilter(params: QueryParams): {
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

  /**
   * Listagem simples: stock (com filtro de saldo/unit_business), brand e
   * productConfigs (filtrado por unit_business quando informado).
   */
  async paginateWithStock(
    params: QueryParams,
    queryConfig: QueryConfig,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Product>> {
    const { stockFilter, stockWhere, paramsWithoutStockFilter } =
      this.extractStockFilter(params);

    return this.findPaginated(paramsWithoutStockFilter, queryConfig, {
      ...extraOptions,
      subQuery: false,
      attributes: { exclude: ["source_payload"] },
      include: [
        {
          model: Stock,
          as: "stocks",
          where: Object.keys(stockWhere).length ? stockWhere : undefined,
          required: !!stockFilter?.stockUnit,
          attributes: ["id", "quantity", "unit_business_id", "total_price"],
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
        },
      ],
    });
  }

  /**
   * Listagem detalhada: todos os includes de paginateWithStock + subgroup
   * (com group) + stock_movements (as "movements"), e enriquece cada
   * produto com lastPurchaseEntries/currentAverageCost quando um
   * unitBusinessId é conhecido (via params.filters.stockUnit.unitBusinessId
   * ou passado explicitamente).
   */
  // ...

  async paginateDetailedWithMovements(
    params: QueryParams,
    queryConfig: QueryConfig,
    unitBusinessId?: string,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<ProductDetailedWithMovements>> {
    const { stockFilter, stockWhere, paramsWithoutStockFilter } =
      this.extractStockFilter(params);

    const resolvedUnitBusinessId =
      unitBusinessId ?? stockFilter?.unitBusinessId;

    const lastMovementDateOrder = literal(`(
    SELECT MAX(sm.movement_date)
    FROM stock_movements sm
    WHERE sm.product_id = "Product"."id"
      AND sm.is_active = true
      ${resolvedUnitBusinessId ? "AND sm.unit_business_id = :orderUnitBusinessId" : ""}
  ) DESC NULLS LAST`);

    const result = await this.findPaginated<ProductDetailedWithMovements>(
      paramsWithoutStockFilter,
      queryConfig,
      {
        ...extraOptions,
        subQuery: false,
        attributes: {
          exclude: ["source_payload"],
        },
        replacements: resolvedUnitBusinessId
          ? { orderUnitBusinessId: resolvedUnitBusinessId }
          : undefined,
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
      undefined,
      [lastMovementDateOrder],
    );

    if (resolvedUnitBusinessId && result.data.length) {
      await this.attachStockCostInfo(result.data, resolvedUnitBusinessId);
    }

    return result;
  }

  /**
   * Equivalente não-paginado de paginateDetailedWithMovements, usado pelo
   * relatório. Mesmos includes + mesma ordenação por último movimento
   * (subquery correlacionada) + mesmo enriquecimento via attachStockCostInfo.
   */
  async findAllDetailedWithMovements(
    params: QueryParams,
    queryConfig: QueryConfig,
    unitBusinessId?: string,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<ProductDetailedWithMovements[]> {
    const { stockFilter, stockWhere, paramsWithoutStockFilter } =
      this.extractStockFilter(params);

    const resolvedUnitBusinessId =
      unitBusinessId ?? stockFilter?.unitBusinessId;

    const lastMovementDateOrder = literal(`(
    SELECT MAX(sm.movement_date)
    FROM stock_movements sm
    WHERE sm.product_id = "Product"."id"
      AND sm.is_active = true
      ${resolvedUnitBusinessId ? "AND sm.unit_business_id = :orderUnitBusinessId" : ""}
  ) DESC NULLS LAST`);

    const resolved = QueryParser.parse(paramsWithoutStockFilter, queryConfig);

    const products = (await this.model.findAll({
      subQuery: false,
      attributes: { exclude: ["source_payload"] },
      ...extraOptions,
      where: resolved.where as WhereOptions,
      order: [lastMovementDateOrder],
      replacements: resolvedUnitBusinessId
        ? { orderUnitBusinessId: resolvedUnitBusinessId }
        : undefined,
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
      await this.attachStockCostInfo(products, resolvedUnitBusinessId);
    }

    return products;
  }

  /**
   * Equivalente não-paginado de paginateWithStock/paginateDetailed, usado
   * pelo relatório. Segue o mesmo padrão de findHistoryByProduct do
   * StockMovementRepository: QueryParser + this.model.findAll.
   */
  async findAllDetailed(
    params: QueryParams,
    queryConfig: QueryConfig,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<Product[]> {
    const { stockFilter, stockWhere, paramsWithoutStockFilter } =
      this.extractStockFilter(params);

    const resolved = QueryParser.parse(paramsWithoutStockFilter, queryConfig);

    return this.model.findAll({
      subQuery: false,
      attributes: { exclude: ["source_payload"] },
      ...extraOptions,
      where: resolved.where as WhereOptions,
      order: resolved.order,
      include: [
        {
          model: Stock,
          as: "stocks",
          where: Object.keys(stockWhere).length ? stockWhere : undefined,
          required: !!stockFilter?.stockUnit,
          attributes: ["id", "quantity", "unit_business_id", "total_price"],
        },
        {
          model: Brand,
          as: "brandRegister",
        },
        {
          model: Subgroup,
          as: "subgroup",
          include: [{ model: Group, as: "group" }],
        },
        {
          model: ProductConfig,
          as: "productConfigs",
          where: stockFilter?.unitBusinessId
            ? { unit_business_id: stockFilter.unitBusinessId }
            : undefined,
          required: false,
        },
      ],
    });
  }

  /**
   * Pendura lastPurchaseEntries (últimas N entradas efetivas de compra,
   * considerando MANUAL_ADJUSTMENT com custo médio manual substituindo a
   * PURCHASE_ENTRY correspondente — ver StockMovementRepository) e
   * currentAverageCost (custo médio do último movimento ativo) em cada
   * produto. Repository-to-repository: não passa pelo StockMovementService
   * de propósito, pra não criar dependência de camada de serviço aqui.
   */
  private async attachStockCostInfo(
    products: Product[],
    unitBusinessId: string,
  ): Promise<void> {
    const productIds = products.map((p) => p.id);

    const [lastEntriesByProduct, lastMovementByProduct] = await Promise.all([
      stockMovementRepository.findLastPurchaseEntries(
        productIds,
        unitBusinessId,
      ),
      stockMovementRepository.findLastMovementsByProducts(
        productIds,
        unitBusinessId,
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

export default new ProductRepository();
