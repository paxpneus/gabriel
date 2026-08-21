import { FindOptions, FindAndCountOptions, Transaction } from "sequelize";
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
import Rim from "../../rims/rim.model";
import TireMeasure from "../../tire-measures/tire-measure.model";
import { ProductCreationAttributes } from "../product.types";

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
    extraOptions?: Omit<
      FindAndCountOptions,
      "where" | "limit" | "offset" | "order"
    >,
  ): Promise<PaginatedResult<Product>> {
    const { stockFilter, stockWhere, paramsWithoutStockFilter } =
      extractStockFilter(params);

    return this.findPaginated(paramsWithoutStockFilter, queryConfig, {
      ...extraOptions,
      subQuery: false,
      distinct: true,
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
          where: stockFilter?.unitBusinessId
            ? { unit_business_id: stockFilter.unitBusinessId }
            : undefined,
          required: false,
        },
      ],
    });
  }

  async upsertByConflictFields(
    values: Partial<ProductCreationAttributes>,
    conflictFields: string[],
    options?: { transaction?: Transaction },
  ): Promise<Product> {
    const [product] = await this.model.upsert(values as any, {
      conflictFields: conflictFields as any,
      transaction: options?.transaction,
    });
    return product;
  }

}

export default new ProductRepository();
