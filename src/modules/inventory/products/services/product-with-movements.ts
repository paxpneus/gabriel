import { FindOptions } from "sequelize";
import {
  PaginatedResult,
  QueryConfig,
  QueryParams,
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Product from "../product.model";
import {
  ProductDetailedWithMovements,
  ProductDetailedWithMovementsSummary,
} from "../product.types";
import { ProductWithMovementsRepository } from "../repository/product-with-movements";
import defaultProductWithMovementsRepository from "../repository/product-with-movements";
import { productQueryConfig } from "../product.query-config";
import {
  averageCostDifference,
  computeAverageCostTrend,
} from "../helpers/product-cost-trend";

/**
 * Service dedicado, estendendo BaseService<Product, ProductWithMovementsRepository>
 * — mesma infra de CRUD genérica (this.repository, this.queryConfig etc.),
 * só que amarrado ao repository "detailed with movements" em vez do
 * ProductRepository "principal".
 */
export class ProductWithMovementsService extends BaseService<
  Product,
  ProductWithMovementsRepository
> {
  constructor(
    repository: ProductWithMovementsRepository = defaultProductWithMovementsRepository,
  ) {
    super(repository);
    this.queryConfig = productQueryConfig;
  }

  async productDetailedWithMovementsSummary(
    params: QueryParams,
    unitBusinessId?: string,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<ProductDetailedWithMovementsSummary>> {
    const response = await this.repository.paginateDetailedWithMovements(
      params,
      this.queryConfig,
      unitBusinessId,
      extraOptions,
    );

    return {
      data: response.data.map((p) => this.normalizeProductWithMovements(p)),
      meta: response.meta,
    };
  }

  async productReport(
    params: QueryParams,
    unitBusinessId?: string,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<ProductDetailedWithMovementsSummary[]> {
    const products = await this.repository.findAllDetailedWithMovements(
      params,
      this.queryConfig,
      unitBusinessId,
      extraOptions,
    );

    return products.map((p) => this.normalizeProductWithMovements(p));
  }

  private normalizeProductWithMovements(
    p: ProductDetailedWithMovements,
  ): ProductDetailedWithMovementsSummary {
    const product = (p as any).toJSON
      ? ((p as any).toJSON() as unknown as ProductDetailedWithMovements)
      : p;

    const lastPurchaseEntries = product.lastPurchaseEntries ?? [];
    const hasSecondEntry = lastPurchaseEntries.length > 1;

    return {
      ...product,
      last_movement: {
        balance: Number(lastPurchaseEntries[0]?.balance_quantity ?? 0),
        average_cost: Number(lastPurchaseEntries[0]?.resulting_average_cost ?? 0),
      },
      second_movement: {
        balance: Number(lastPurchaseEntries[1]?.balance_quantity ?? 0),
        average_cost: hasSecondEntry
          ? Number(lastPurchaseEntries[1].resulting_average_cost ?? 0)
          : 0,
      },
      average_cost_difference: averageCostDifference(lastPurchaseEntries),
      average_cost_trend: computeAverageCostTrend(lastPurchaseEntries),
    };
  }
}

export default new ProductWithMovementsService();