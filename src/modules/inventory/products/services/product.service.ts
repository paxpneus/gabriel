import {
  CreateOptions,
  FindOptions,
  Op,
  CreationAttributes,
  UpdateOptions,
  Transaction,
  col,
} from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Product from "../product.model";
import productRepository, {
  ProductRepository,
} from "../repository/product.repository";
import ProductConfig from "../../product-config/product_config.model";
import {
  ProductCreationAttributes,
  ProductDetailedWithMovements,
  ProductDetailedWithMovementsSummary,
  ProductSalesReportFilters,
  ProductSalesReportRow,
  TireCompositeSearchParams,
  TireMatchProbability,
  TireSearchCandidate,
  TireSearchMode,
  TireSearchParams,
} from "../product.types";
import supplierMappingService from "../../supplier-mapping/supplier-mapping.service";
import productConfigService from "../../product-config/product_config.service";
import {
  resolveIntegrationsIdForUnitBusiness,
  assertEanNotOwnedByAnotherProduct,
  normalizeEan,
  buildEanZeroVariants,
} from "../../../handlers/tecinco/queues/helpers/product.helpers";
import productWithMovementsRepository from "../repository/product-with-movements";
import KitComponent from "../../kit-components/kit-component.model";
import kitComponentService from "../../kit-components/kit-component.service";
import rimService from "../../rims/rim.service";
import tireMeasureService from "../../tire-measures/tire-measure.service";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import { productMappedToIntegrationWhere } from "../helpers/integration-mapping-filters";
import { buildMeasureNameRegex, buildTokenRegex } from "../helpers/tire-search";
import brandsService from "../../brands/brands.service";
import expeditionBatchService from "../../../warehouse/expedition/batch/batch.service";
import expeditionBatchItemsService from "../../../warehouse/expedition/batch-items/batch-items.service";
import auditLogService from "../../../global/audit-logs/audit-log.service";
import AuditLog from "../../../global/audit-logs/audit-log.model";
import { AuditEntity } from "../../../global/audit-logs/audit-log.types";

export class ProductService extends BaseService<Product, ProductRepository> {
  constructor() {
    super(productRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: ["created_at", "name"],
        sortDir: "DESC",
      },
      searchFields: [
        "name",
        "$productConfigs.sku$",
        "$productConfigs.gtin$",
      ],
      sortableFields: [
        "name",
        "$productConfigs.sku$",
        "$productConfigs.gtin$",
      ],
      filterableFields: ["type"],
      customSort: {
        gtin: (dir) => [col("productConfigs.gtin"), dir],
      },
      customFields: {
        sku: (value) => ({
          "$productConfigs.sku$": value,
        }),
        gtin: (value) => ({
          "$productConfigs.gtin$": value,
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

  /** Igual ao `paginate`, mas só produtos com integration mapping na integração da loja informada. */
  async paginateMappedToUnitBusinessIntegration(
    params: QueryParams,
    unitBusinessId: string,
  ): Promise<PaginatedResult<Product>> {
    const unitBusiness = await unitBusinessService.findById(unitBusinessId, {
      attributes: ["integrations_id"],
    });
    return this.repository.paginateWithStock(
      params,
      this.queryConfig,
      undefined,
      productMappedToIntegrationWhere(unitBusiness?.integrations_id),
    );
  }

  async findByIdFull(
    id: string,
    unitBusinessId?: string,
    options?: FindOptions,
  ): Promise<Product | null> {
    return this.repository.findByIdWithRelations(id, unitBusinessId, options);
  }

  // Resolve o produto de um código lido (exato + variações de zero à esquerda) no gtin de qualquer loja da integração e
  // no DE x PARA dela — validação sempre por integração. Mais de um produto (inclusive exato vs. variação) é erro.
  private async resolveProductIdByCode(
    code: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<{ productId: string; matchedCode: string } | null> {
    const normalized = normalizeEan(code);
    if (!normalized) return null;

    const codes = buildEanZeroVariants(normalized);
    const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId, transaction);

    const [configs, mappings] = await Promise.all([
      productConfigService.findGtinOwnersInIntegration(codes, integrationsId, null, transaction),
      supplierMappingService.findAll({
        where: { supplier_product_code: { [Op.in]: codes }, integrations_id: integrationsId },
        attributes: ["product_id", "supplier_product_code"],
        transaction,
      }),
    ]);

    const productIds = [...new Set([...configs, ...mappings].map((row) => row.product_id))];
    if (!productIds.length) return null;
    if (productIds.length > 1) {
      throw new Error(
        `Código ${normalized} corresponde a mais de um produto (considerando zeros à esquerda) — não é possível identificar o produto`,
      );
    }

    // Código como está salvo (exato ou variação) — o scan da expedição confere ele contra a etiqueta.
    const matchedCode = configs[0]?.gtin ?? mappings[0]?.supplier_product_code ?? normalized;
    return { productId: productIds[0], matchedCode };
  }

  // Bipe da expedição/entrada (scan-logs) — ver resolveProductIdByCode.
  async findByCode(
    code: string,
    unitBusinessId: string,
    options?: { transaction?: Transaction },
  ): Promise<{ product: Product; matchedCode: string } | null> {
    const resolved = await this.resolveProductIdByCode(code, unitBusinessId, options?.transaction);
    if (!resolved) return null;

    const product = await this.findById(resolved.productId, {
      transaction: options?.transaction,
    });
    if (!product) return null;
    return { product, matchedCode: resolved.matchedCode };
  }

  /**
   * Busca somente leitura por código (GET /by-code/:code), mesma regra dos bipes (ver resolveProductIdByCode),
   * devolvendo o produto com as relações da unit_business do usuário logado. Não cria nem altera nada.
   */
  async findProductByCode(
    code: string,
    unitBusinessId: string,
  ): Promise<Product | null> {
    const resolved = await this.resolveProductIdByCode(code, unitBusinessId);
    if (!resolved) return null;

    return this.repository.findByIdWithRelations(resolved.productId, unitBusinessId);
  }

  // Histórico de auditoria do produto (entradas PRODUCT já trazem em `changes.affected` o que a operação mexeu).
  async findAuditLogs(productId: string, params: QueryParams): Promise<PaginatedResult<AuditLog>> {
    const product = await this.findById(productId, { attributes: ["id"] });
    if (!product) throw new Error("Produto não encontrado");
    return auditLogService.paginateByEntity(AuditEntity.PRODUCT, productId, params);
  }

  /**
   * Auto busca de pneu: medida obrigatória e estrita no nome; índice de carga e marca só pontuam e ordenam, nunca excluem.
   * IN_BATCH restringe aos itens do lote (da loja do usuário) que faltam bipar; null = lote não encontrado.
   */
  async searchTireCandidates(
    params: TireSearchParams,
    unitBusinessId: string,
  ): Promise<TireSearchCandidate[] | null> {
    let productIds: string[] | undefined;
    if (params.mode === TireSearchMode.IN_BATCH) {
      const batch = await expeditionBatchService.findOne({
        where: { id: params.expeditionBatchId, unit_business_id: unitBusinessId },
        attributes: ["id"],
      });
      if (!batch) return null;
      productIds = await expeditionBatchItemsService.findPendingProductIds(batch.id);
      if (!productIds.length) return [];
    }

    const [unitBusiness, matchedBrand] = await Promise.all([
      unitBusinessService.findById(unitBusinessId, { attributes: ["integrations_id"] }),
      params.brand ? brandsService.findSimilarBrand(params.brand) : null,
    ]);

    const measureNameRegex = buildMeasureNameRegex(params.measure);
    const products = await this.repository.findTireCandidates({
      measureNameRegex,
      productIds,
      unitBusinessId,
      integrationsId: unitBusiness?.integrations_id,
    });

    const measurePattern = new RegExp(measureNameRegex, "gi");
    const loadIndexPattern = params.loadIndex ? buildTokenRegex(params.loadIndex) : null;
    const brandPattern = params.brand ? buildTokenRegex(params.brand) : null;
    const total = Number(!!loadIndexPattern) + Number(!!brandPattern);

    const candidates = products.map((item): TireSearchCandidate => {
      const { mapped_in_user_integration, ...product } = item.get({ plain: true }) as unknown as Record<string, unknown>;
      // Índice/marca procurados no nome sem a medida, pra não casar pedaço dela.
      const nameWithoutMeasure = String(product.name).replace(measurePattern, " ");

      let loadIndexMatch: boolean | null = null;
      if (loadIndexPattern) loadIndexMatch = loadIndexPattern.test(nameWithoutMeasure);

      // Marca bate pelo cadastro (brand_id da marca parecida) ou pelo texto no nome — pneu sem brand_id ainda pontua.
      let brandMatch: boolean | null = null;
      if (brandPattern) {
        brandMatch =
          (!!matchedBrand && product.brand_id === matchedBrand.id) ||
          brandPattern.test(nameWithoutMeasure);
      }

      const matched = Number(!!loadIndexMatch) + Number(!!brandMatch);
      let probability: TireMatchProbability | null = null;
      if (total > 0 && matched === total) probability = TireMatchProbability.HIGH;
      else if (total > 0 && matched === 0) probability = TireMatchProbability.UNLIKELY;
      else if (total > 0) probability = TireMatchProbability.MEDIUM;

      return {
        product,
        matches: { load_index: loadIndexMatch, brand: brandMatch },
        score: { matched, total },
        probability,
        mapped_in_user_integration: !!mapped_in_user_integration,
      };
    });

    // Ordem: probabilidade; empate em MEDIA → quem bateu o índice antes de quem bateu só a marca; depois nome.
    const probabilityRank = (probability: TireMatchProbability | null): number => {
      if (probability === TireMatchProbability.HIGH) return 0;
      if (probability === TireMatchProbability.MEDIUM) return 1;
      if (probability === TireMatchProbability.UNLIKELY) return 2;
      return 0;
    };
    return candidates.sort(
      (a, b) =>
        probabilityRank(a.probability) - probabilityRank(b.probability) ||
        Number(!!b.matches.load_index) - Number(!!a.matches.load_index) ||
        String(a.product.name).localeCompare(String(b.product.name)),
    );
  }

  /**
   * Busca composta paginada: mesma lógica da auto busca (medida filtra; índice, marca por brand_id e coringa opcionais,
   * só pontuam/ordenam), paginada e com os dados do paginate. Item no formato da auto busca; null = lote não encontrado.
   */
  async paginateTireCandidates(
    params: QueryParams,
    search: TireCompositeSearchParams,
    unitBusinessId: string,
  ): Promise<PaginatedResult<TireSearchCandidate> | null> {
    // Lote sem pendência: `Op.in` vazio não casa nada → página vazia com meta certo.
    let productIds: string[] | undefined;
    if (search.mode === TireSearchMode.IN_BATCH) {
      const batch = await expeditionBatchService.findOne({
        where: { id: search.expeditionBatchId, unit_business_id: unitBusinessId },
        attributes: ["id"],
      });
      if (!batch) return null;
      productIds = await expeditionBatchItemsService.findPendingProductIds(batch.id);
    }

    const unitBusiness = await unitBusinessService.findById(unitBusinessId, { attributes: ["integrations_id"] });
    const result = await this.repository.paginateTireCandidates(params, this.queryConfig, {
      measureNameRegex: buildMeasureNameRegex(search.measure),
      loadIndexRegex: search.loadIndex ? buildTokenRegex(search.loadIndex).source : undefined,
      brandId: search.brandId,
      otherDescription: search.otherDescription,
      productIds,
      integrationsId: unitBusiness?.integrations_id,
    });

    const data = result.data.map((item): TireSearchCandidate => {
      const { load_index_match, brand_match, other_description_match, mapped_in_user_integration, ...product } =
        item.get({ plain: true }) as unknown as Record<string, unknown>;

      // Cada opcional não enviado fica null em `matches` e fora do total; só a medida → probability null.
      const matches = {
        load_index: search.loadIndex ? !!load_index_match : null,
        brand: search.brandId ? !!brand_match : null,
        other_description: search.otherDescription ? !!other_description_match : null,
      };
      const sent = Object.values(matches).filter((match) => match !== null);
      const total = sent.length;
      const matched = sent.filter(Boolean).length;
      let probability: TireMatchProbability | null = null;
      if (total > 0 && matched === total) probability = TireMatchProbability.HIGH;
      else if (total > 0 && matched === 0) probability = TireMatchProbability.UNLIKELY;
      else if (total > 0) probability = TireMatchProbability.MEDIUM;

      return {
        product,
        matches,
        score: { matched, total },
        probability,
        mapped_in_user_integration: !!mapped_in_user_integration,
      };
    });

    return { data, meta: result.meta };
  }

  async create(
    data: Partial<ProductCreationAttributes> & {
      config?: Partial<CreationAttributes<ProductConfig>>;
    },
    // userId: quem editou (auditoria da remoção de DE x PARA de outro produto); não vai pro Sequelize.
    options?: CreateOptions & { userId?: string | null },
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
            `Produto "${product.name}" criado, mas sem os dados de venda (SKU, GTIN, preço) para nenhuma loja — o cadastro enviado não informou a unidade de negócio. [ProductService.create product_id=${product.id}: config sem unit_business_id, ProductConfig não criado]`,
          );
        } else {
          if (config.gtin) {
            await assertEanNotOwnedByAnotherProduct({
              productId: product.id,
              unitBusinessId: config.unit_business_id,
              candidates: [{ field: "gtin", value: config.gtin }],
              logPrefix: `[ProductService.create] product_id=${product.id}`,
              transaction,
              audit: { userId: options?.userId ?? null },
            });
          }

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
    options?: Partial<UpdateOptions> & { userId?: string | null },
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
          if (config.gtin) {
            await assertEanNotOwnedByAnotherProduct({
              productId: id,
              unitBusinessId: config.unit_business_id,
              candidates: [{ field: "gtin", value: config.gtin }],
              logPrefix: `[ProductService.update] product_id=${id}`,
              transaction,
              audit: { userId: options?.userId ?? null },
            });
          }

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
    return kitComponentService.findAll({
      where: { product_kit_id: productKitId },
    });
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
    const products =
      await productWithMovementsRepository.findAllDetailedWithMovements(
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
