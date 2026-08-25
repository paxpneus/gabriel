import { FindOptions, FindAndCountOptions, QueryTypes, Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import sequelize from "../../../../config/sequelize";
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
import {
  ProductCreationAttributes,
  ProductSalesReportFilters,
  ProductSalesReportRow,
} from "../product.types";

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

  /**
   * Relatório de vendas por produto — mesma fonte de dados do sales-report
   * (sales_order_item_snapshots/sales_order_snapshots), agrupado por
   * produto/sku. rim é resolvido via join com products (não é denormalizado
   * no snapshot); measure usa sois.product_measure, igual ao sales-report.
   * minQuantitySold/maxQuantitySold filtram por HAVING, pois quantidade
   * vendida é um agregado, não uma coluna do snapshot.
   */
  async getSalesReport(
    filters: ProductSalesReportFilters,
  ): Promise<ProductSalesReportRow[]> {
    return sequelize.query<ProductSalesReportRow>(
      `
      WITH filtered_items AS (
        SELECT
          sois.product_id,
          sois.sku,
          sois.quantity,
          sois.gross_total,
          sois.total_cost_snapshot,
          sois.supplier_discount_value,
          sois.contribution_value,
          sois.net_total,
          sois.average_cost_snapshot,
          sois.commission_value
        FROM sales_order_item_snapshots sois
        JOIN sales_order_snapshots sos ON sos.id = sois.order_snapshot_id
        LEFT JOIN products p ON p.id = sois.product_id
        WHERE sois.order_date BETWEEN CAST(:dateFrom AS date) AND CAST(:dateTo AS date)
          AND sos.snapshot_status = 'completed'
          AND (COALESCE(array_length(ARRAY[:unitBusinessIds]::uuid[], 1), 0) = 0
               OR sois.unit_business_id = ANY(ARRAY[:unitBusinessIds]::uuid[]))
          AND (cardinality(ARRAY[:productIds]::uuid[]) = 0
               OR sois.product_id = ANY(ARRAY[:productIds]::uuid[]))
          AND (CAST(:rim AS varchar) IS NULL
               OR UPPER(TRIM(p.rim)) = UPPER(TRIM(CAST(:rim AS varchar))))
          AND (CAST(:measure AS varchar) IS NULL
               OR UPPER(TRIM(sois.product_measure)) = UPPER(TRIM(CAST(:measure AS varchar))))
          AND (CAST(:productType AS varchar) IS NULL
               OR UPPER(TRIM(p.type::varchar)) = UPPER(TRIM(CAST(:productType AS varchar))))
      )
      SELECT
        fi.product_id,
        p.name AS product_name,
        fi.sku,
        COALESCE(SUM(fi.quantity), 0) AS quantity_sold,
        COALESCE(SUM(fi.gross_total), 0) AS gross_total,
        COALESCE(SUM(fi.total_cost_snapshot), 0) AS total_cost,
        COALESCE(SUM(fi.supplier_discount_value), 0) AS total_supplier_discount,
        COALESCE(SUM(fi.contribution_value), 0) AS contribution_value,
        CASE
          WHEN COALESCE(SUM(fi.net_total), 0) = 0 THEN 0
          ELSE ROUND(
            (COALESCE(SUM(fi.contribution_value), 0) * 100
              / NULLIF(SUM(fi.net_total), 0))::numeric,
            2
          )
        END AS contribution_pct,
        COALESCE(SUM(fi.gross_total), 0) - COALESCE(SUM(fi.total_cost_snapshot), 0) AS markup_value,
        CASE
          WHEN COALESCE(SUM(fi.total_cost_snapshot), 0) = 0 THEN 0
          ELSE ROUND(
            (
              (COALESCE(SUM(fi.gross_total), 0) - COALESCE(SUM(fi.total_cost_snapshot), 0)) * 100
              / NULLIF(SUM(fi.total_cost_snapshot), 0)
            )::numeric,
            2
          )
        END AS markup_pct,
        CASE
          WHEN COALESCE(SUM(fi.quantity), 0) = 0 THEN 0
          ELSE ROUND(
            (SUM(fi.average_cost_snapshot * fi.quantity) / NULLIF(SUM(fi.quantity), 0))::numeric,
            2
          )
        END AS average_cost,
        COALESCE(SUM(fi.commission_value), 0) AS commission_value
      FROM filtered_items fi
      LEFT JOIN products p ON p.id = fi.product_id
      GROUP BY fi.product_id, p.name, fi.sku
      HAVING (CAST(:minQuantitySold AS numeric) IS NULL
              OR COALESCE(SUM(fi.quantity), 0) >= CAST(:minQuantitySold AS numeric))
         AND (CAST(:maxQuantitySold AS numeric) IS NULL
              OR COALESCE(SUM(fi.quantity), 0) <= CAST(:maxQuantitySold AS numeric))
      ORDER BY quantity_sold DESC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          unitBusinessIds: filters.unitBusinessIds ?? [],
          productIds: filters.productIds ?? [],
          rim: filters.rim ?? null,
          measure: filters.measure ?? null,
          productType: filters.productType ?? null,
          minQuantitySold: filters.minQuantitySold ?? null,
          maxQuantitySold: filters.maxQuantitySold ?? null,
        },
      },
    );
  }
}

export default new ProductRepository();
