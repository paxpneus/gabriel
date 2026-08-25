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
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Product from "../product.model";
import productRepository, { ProductRepository } from "../repository/product.repository";
import ProductConfig from "../../product-config/product_config.model";
import {
  ProductCreationAttributes,
  ProductDetailedWithMovements,
  ProductDetailedWithMovementsSummary,
  ProductSalesReportFilters,
  ProductSalesReportRow,
} from "../product.types";
import supplierMappingService from "../../supplier-mapping/supplier-mapping.service";
import productWithMovementsRepository from '../repository/product-with-movements'
import KitComponent from "../../kit-components/kit-component.model";
import kitComponentService from "../../kit-components/kit-component.service";
import rimService from "../../rims/rim.service";
import tireMeasureService from "../../tire-measures/tire-measure.service";

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
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Product>> {
    return this.repository.paginateWithStock(
      params,
      this.queryConfig,
      extraOptions,
    );
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

  // ─── Upsert centralizado de produto + composição de kit ────────────────────
  // Usado pelas integrações (Bling, Tecinco) na ingestão de produtos, pra não
  // duplicar create/update de Product e sync de kit_components em cada uma.
  async upsertWithComponents(params: {
    id?: string;
    conflictFields?: string[];
    values: Partial<ProductCreationAttributes>;
    components?: Array<{ product_component_id: string; quantity: number }>;
    transaction?: Transaction;
  }): Promise<Product> {
    const sequelize = Product.sequelize!;
    const ownTransaction = !params.transaction;
    const transaction = params.transaction ?? (await sequelize.transaction());

    try {
      let product: Product;
      const values: Partial<ProductCreationAttributes> = { ...params.values };

      if (values.rim !== undefined) {
        const rim = await rimService.findOrCreate(values.rim as string | null, {
          transaction,
        });
        values.rim_id = rim?.id ?? null;
      }
      if (values.measure !== undefined) {
        const measure = await tireMeasureService.findOrCreate(
          values.measure as string | null,
          { transaction },
        );
        values.measure_id = measure?.id ?? null;
      }

      if (params.id) {
        const updated = await this.repository.update(params.id, values, {
          transaction,
        });
        if (!updated) {
          throw new Error(
            `ProductService.upsertWithComponents: produto id=${params.id} não encontrado`,
          );
        }
        product = updated;
      } else if (params.conflictFields?.length) {
        product = await this.repository.upsertByConflictFields(
          values,
          params.conflictFields,
          { transaction },
        );
      } else {
        product = await this.repository.create(values, { transaction });
      }

      if (params.components !== undefined) {
        await kitComponentService.syncForKit(product.id, params.components, {
          transaction,
        });
      }

      if (ownTransaction) {
        await transaction.commit();
      }

      return (
        (await this.repository.findById(product.id, {
          include: [{ model: KitComponent, as: "kitComponents" }],
        })) ?? product
      );
    } catch (err) {
      if (ownTransaction) {
        await transaction.rollback();
      }
      throw err;
    }
  }

  async getKitComponents(productKitId: string): Promise<KitComponent[]> {
    return kitComponentService.findAll({ where: { product_kit_id: productKitId } });
  }

  async getSalesReport(
    filters: ProductSalesReportFilters,
  ): Promise<ProductSalesReportRow[]> {
    return this.repository.getSalesReport(filters);
  }

  async productReport(
    params: QueryParams,
    unitBusinessId?: string,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<ProductDetailedWithMovementsSummary[]> {
    const products = await productWithMovementsRepository.findAllDetailedWithMovements(
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

    const lastAverageCost = Number(
      lastPurchaseEntries[0]?.resulting_average_cost ?? 0,
    );

    const secondAverageCost = hasSecondEntry
      ? Number(lastPurchaseEntries[1].resulting_average_cost ?? 0)
      : null;

    const averageCostDifference = hasSecondEntry
      ? lastAverageCost - (secondAverageCost as number)
      : 0;

    const averageCostTrend = !hasSecondEntry
      ? "UNCHANGED"
      : averageCostDifference > 0
        ? "INCREASED"
        : averageCostDifference < 0
          ? "DECREASED"
          : "UNCHANGED";

    return {
      ...product,
      last_movement: {
        balance: Number(lastPurchaseEntries[0]?.balance_quantity ?? 0),
        average_cost: lastAverageCost,
      },
      second_movement: {
        balance: Number(lastPurchaseEntries[1]?.balance_quantity ?? 0),
        average_cost: secondAverageCost ?? 0,
      },
      average_cost_difference: averageCostDifference,
      average_cost_trend: averageCostTrend,
    };
  }
}

export default new ProductService();
