import {
  CreateOptions,
  FindOptions,
  Op,
  CreationAttributes,
  UpdateOptions,
  Transaction,
} from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../shared/query/query.types";
import BaseService from "../../../shared/utils/base-models/base-service";
import Product from "./product.model";
import productRepository, { ProductRepository } from "./product.repository";
import Stock from "../stock/stock/stock.model";
import ProductConfig from "../product-config/product_config.model";
import { ProductCreationAttributes } from "./product.types";
import supplierMappingService from "../supplier-mapping/supplier-mapping.service";
import Group from "../groups/group/group.model";
import Subgroup from "../groups/subgroup/subgroup.model";
import Brand from "../brands/brands.model";

type StockUnitFilter = {
  unitBusinessId?: string;
  stockUnit?: "positive" | "zero";
};

export class ProductService extends BaseService<Product, ProductRepository> {
  constructor() {
    super(productRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: ["created_at", "name"],
        sortDir: "DESC",
      },
      searchFields: ["name", "ean", "ean_tribut", "$productConfigs.sku$"],
      filterableFields: ["type"],
      customFields: {
        sku: (value) => ({
          "$productConfigs.sku$": value,
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
      },
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Product>> {
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

    const paramsWithoutStockFilter: QueryParams = {
      ...params,
      filters: Object.keys(filters).length ? filters : undefined,
    };

    return super.paginate(paramsWithoutStockFilter, {
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
          model: Subgroup,
          as: 'subgroup',
          include: [
            {
              model: Group,
              as: 'group'
            }
          ]
        },
        {
          model: Brand,
          as: 'brandRegister',
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

  async findByIdFull(
    id: string,
    unitBusinessId?: string,
    options?: FindOptions,
  ): Promise<Product | null> {
    return this.repository.findByIdWithRelations(id, unitBusinessId, options);
  }

  async findByCode(
    code: string,
    options?: { transaction?: Transaction },
  ): Promise<{ product: Product; matchedCode: string } | null> {
    const byEan = await this.findOne({
      where: {
        [Op.or]: [{ ean: code }, { ean_tribut: code }],
      },
      transaction: options?.transaction,
    });

    if (byEan) return { product: byEan, matchedCode: code };

    const mapping = await supplierMappingService.findOne({
      where: { supplier_product_code: code },
      include: [{ model: Product, as: "product" }],
      transaction: options?.transaction,
    });

    const product = (mapping as any)?.product ?? null;
    if (!product) return null;

    return { product, matchedCode: code };
  }

  async create(
    data: Partial<ProductCreationAttributes> & {
      config?: Partial<CreationAttributes<ProductConfig>>;
    },
    options?: CreateOptions,
  ): Promise<Product> {
    const { config, ...productData } = data;

    const sequelize = Product.sequelize!;
    const ownTransaction = !options?.transaction;
    const transaction = options?.transaction ?? (await sequelize.transaction());

    try {
      const product = await this.repository.create(
        productData as Partial<ProductCreationAttributes>,
        { ...options, transaction },
      );

      if (config) {
        if (!config.unit_business_id) {
          console.warn(
            `[ProductService.create] product_id=${product.id} — config sem unit_business_id, ProductConfig não criado`,
          );
        } else {
          await ProductConfig.create(
            {
              ...config,
              product_id: product.id,
            } as CreationAttributes<ProductConfig>,
            { transaction },
          );
        }
      }

      if (ownTransaction) {
        await transaction.commit();
      }

      return (
        (await this.repository.findById(product.id, {
          include: [{ model: ProductConfig, as: "productConfigs" }],
        })) ?? product
      );
    } catch (err) {
      if (ownTransaction) {
        await transaction.rollback();
      }
      throw err;
    }
  }

  async update(
    id: string,
    data: Partial<ProductCreationAttributes> & {
      config?: Partial<CreationAttributes<ProductConfig>>;
    },
    options?: Partial<UpdateOptions>,
  ): Promise<Product> {
    const { config, ...productData } = data;

    const sequelize = Product.sequelize!;
    const ownTransaction = !options?.transaction;
    const transaction = options?.transaction ?? (await sequelize.transaction());

    try {
      await this.repository.update(
        id,
        productData as Partial<ProductCreationAttributes>,
        { ...options, transaction },
      );

      if (config) {
        if (!config.unit_business_id) {
          console.warn(
            `[ProductService.update] product_id=${id} — config sem unit_business_id, ProductConfig não atualizado`,
          );
        } else {
          const existingConfig = await ProductConfig.findOne({
            where: {
              product_id: id,
              unit_business_id: config.unit_business_id,
            },
            transaction,
          });

          if (existingConfig) {
            await existingConfig.update(config, { transaction });
          } else {
            await ProductConfig.create(
              {
                ...config,
                product_id: id,
              } as CreationAttributes<ProductConfig>,
              { transaction },
            );
          }
        }
      }

      if (ownTransaction) {
        await transaction.commit();
      }

      const updated = await this.repository.findById(id, {
        include: [{ model: ProductConfig, as: "productConfigs" }],
      });

      if (!updated) {
        throw new Error(`Product id=${id} não encontrado após update`);
      }

      return updated;
    } catch (err) {
      if (ownTransaction) {
        await transaction.rollback();
      }
      throw err;
    }
  }

  async productReport(
  params: QueryParams,
  extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
): Promise<Product[]> {
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

  const paramsWithoutStockFilter: QueryParams = {
    ...params,
    filters: Object.keys(filters).length ? filters : undefined,
  };

  return super.findAll(
    {
      subQuery: false,
      attributes: { exclude: ["source_payload"] },
      ...extraOptions, 
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
    },
    paramsWithoutStockFilter, 
    this.queryConfig,          
  );
}

}

export default new ProductService();