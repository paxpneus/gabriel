import {
  FindOptions,
  FindAndCountOptions,
  Op,
  Order,
  ProjectionAlias,
  QueryTypes,
  Sequelize,
  Transaction,
  WhereOptions,
} from "sequelize";
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
import { productMappedToIntegrationLiteral } from "../helpers/integration-mapping-filters";

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
          // reserved_quantity/virtual_stock: só leitura pro front (by id/full e by-code)
          attributes: ["id", "quantity", "unit_business_id", "total_price", "reserved_quantity", "virtual_stock"],
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
    forcedWhere?: WhereOptions,
    // Ordem/colunas calculadas da busca composta de pneu; sem eles, segue o sortBy normal.
    forcedOrder?: FindOptions["order"],
    extraAttributes?: ProjectionAlias[],
  ): Promise<PaginatedResult<Product>> {
    const { stockFilter, stockWhere, paramsWithoutStockFilter } =
      extractStockFilter(params);

    return this.findPaginated(paramsWithoutStockFilter, queryConfig, {
      ...extraOptions,
      subQuery: false,
      distinct: true,
      attributes: { exclude: ["source_payload"], include: extraAttributes ?? [] },
      include: [
        {
          model: Stock,
          as: "stocks",
          where: Object.keys(stockWhere).length ? stockWhere : undefined,
          required: !!stockFilter?.stockUnit,
          // reserved_quantity/virtual_stock: só leitura pro front (paginate e busca de pneu paginada)
          attributes: ["id", "quantity", "unit_business_id", "total_price", "reserved_quantity", "virtual_stock"],
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
    }, forcedWhere, forcedOrder);
  }

  // Busca composta paginada: mesmo filtro da auto busca (UNIT/TIRE ativo, medida estrita no nome) com os dados do
  // paginate; índice (no nome sem a medida), marca (brand_id) e coringa (texto no nome) viram colunas que só ordenam.
  async paginateTireCandidates(
    params: QueryParams,
    queryConfig: QueryConfig,
    search: {
      measureNameRegex: string;
      loadIndexRegex?: string;
      brandId?: string;
      otherDescription?: string;
      productIds?: string[];
      integrationsId: string | null | undefined;
    },
  ): Promise<PaginatedResult<Product>> {
    const where: WhereOptions = {
      type: "UNIT",
      category: "TIRE",
      is_active: true,
      name: { [Op.iRegexp]: search.measureNameRegex },
    };
    if (search.productIds) Object.assign(where, { id: { [Op.in]: search.productIds } });

    // Opcional não enviado → FALSE (não soma na ordem; o service devolve null em `matches`).
    let loadIndexMatch = "FALSE";
    if (search.loadIndexRegex) {
      const nameWithoutMeasure = `regexp_replace("Product"."name", ${sequelize.escape(search.measureNameRegex)}, ' ', 'gi')`;
      loadIndexMatch = `(${nameWithoutMeasure} ~* ${sequelize.escape(search.loadIndexRegex)})`;
    }
    let brandMatch = "FALSE";
    if (search.brandId) brandMatch = `COALESCE("Product"."brand_id" = ${sequelize.escape(search.brandId)}, FALSE)`;
    // Campo coringa: texto livre contido no nome; `%`/`_`/`\` digitados valem como texto.
    let otherDescriptionMatch = "FALSE";
    if (search.otherDescription) {
      const likeText = search.otherDescription.replace(/[\\%_]/g, "\\$&");
      otherDescriptionMatch = `("Product"."name" ILIKE ${sequelize.escape(`%${likeText}%`)})`;
    }

    // Probabilidade (quantos bateram) → quem bateu o índice antes de quem não bateu → nome. Só entra critério enviado:
    // o Postgres recusa constante solta (`ORDER BY FALSE`).
    const order: Order = [];
    if (search.loadIndexRegex || search.brandId || search.otherDescription) {
      order.push([Sequelize.literal(`${loadIndexMatch}::int + ${brandMatch}::int + ${otherDescriptionMatch}::int`), "DESC"]);
    }
    if (search.loadIndexRegex) order.push([Sequelize.literal(loadIndexMatch), "DESC"]);
    order.push(["name", "ASC"]);

    return this.paginateWithStock(
      params,
      queryConfig,
      undefined,
      where,
      order,
      [
        [Sequelize.literal(loadIndexMatch), "load_index_match"],
        [Sequelize.literal(brandMatch), "brand_match"],
        [Sequelize.literal(otherDescriptionMatch), "other_description_match"],
        [productMappedToIntegrationLiteral(search.integrationsId), "mapped_in_user_integration"],
      ],
    );
  }

  // Candidatos da auto busca de pneu: UNIT/TIRE ativos com a medida no nome, de qualquer integração, com a flag de
  // mapeado na integração do usuário e config/estoque da loja dele. `productIds` restringe aos itens do lote.
  async findTireCandidates(params: {
    measureNameRegex: string;
    productIds?: string[];
    unitBusinessId: string;
    integrationsId: string | null | undefined;
  }): Promise<Product[]> {
    const where: WhereOptions = {
      type: "UNIT",
      category: "TIRE",
      is_active: true,
      name: { [Op.iRegexp]: params.measureNameRegex },
    };
    if (params.productIds) Object.assign(where, { id: { [Op.in]: params.productIds } });

    return this.model.findAll({
      where,
      attributes: [
        "id",
        "name",
        "brand_id",
        "brand",
        "line",
        [productMappedToIntegrationLiteral(params.integrationsId), "mapped_in_user_integration"],
      ],
      include: [
        { model: Brand, as: "brandRegister", attributes: ["id", "name"], required: false },
        {
          model: ProductConfig,
          as: "productConfigs",
          where: { unit_business_id: params.unitBusinessId },
          attributes: ["id", "sku", "gtin", "unit_business_id"],
          required: false,
        },
        {
          model: Stock,
          as: "stocks",
          where: { unit_business_id: params.unitBusinessId },
          attributes: ["id", "quantity", "unit_business_id"],
          required: false,
        },
      ],
      order: [["name", "ASC"]],
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
