import { FindOptions } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import {
  QueryConfig,
  QueryParams,
  PaginatedResult,
} from "../../../../shared/query/query.types";
import Product from "../product.model";
import Stock from "../../stock/stock/stock.model";
import ProductConfig from "../../product-config/product_config.model";
import Brand from "../../brands/brands.model";

import { extractStockFilter } from "../product.query-config";

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
      extractStockFilter(params);

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

}

export default new ProductRepository();
