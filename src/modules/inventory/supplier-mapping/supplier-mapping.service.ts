import {
  CreateOptions,
  ForeignKeyConstraintError,
  Transaction,
  UniqueConstraintError,
} from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import SupplierMapping from "./supplier-mapping.model";
import supplierMappingRepository, {
  SupplierMappingRepository,
} from "./supplier-mapping.repository";
import {
  EanOwners,
  FullSupplierMapping,
  ProductSupplierMappingInput,
  SupplierMappingCreationAttributes,
} from "./supplier-mapping.types";
import {
  buildEanZeroVariants,
  normalizeEan,
  resolveIntegrationsIdForUnitBusiness,
} from "../../handlers/tecinco/queues/helpers/product.helpers";
import productConfigService from "../product-config/product_config.service";
import sequelize from "../../../config/sequelize";
import unmappedInvoiceProductService from "../unmapped-invoice-product/unmapped-invoice-product.service";
import integrationMappingService from "../../integrations/integration-mapping/integration-mapping.service";
import {
  QueryParams,
  PaginatedResult,
} from "../../../shared/query/query.types";
import Integration from "../../integrations/integrations/integrations.model";

export class SupplierMappingService extends BaseService<
  SupplierMapping,
  SupplierMappingRepository
> {
  constructor() {
    super(supplierMappingRepository);
  }

  async findByProductCode(
    ean: string,
    unitBusinessId: string,
  ): Promise<FullSupplierMapping | null> {
    if (!ean) {
      throw Error("EAN Não informado");
    }

    const integrationsId =
      await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

    const supplierFound = await this.repository.findSupplierByProductCode(
      ean,
      integrationsId,
    );

    if (!supplierFound) return null;

    return supplierFound;
  }

  // Quem (além de excludeProductId) usa o EAN — exato ou com zero à esquerda — na integração:
  // SupplierMapping da integração e ProductConfig.gtin de qualquer loja dela.
  async findEanOwners(
    ean: string,
    integrationsId: string,
    excludeProductId: string | null,
    transaction?: Transaction,
  ): Promise<EanOwners> {
    const normalized = normalizeEan(ean);
    if (!normalized) return { supplierMappings: [], productConfigs: [] };

    const codes = buildEanZeroVariants(normalized);
    const [supplierMappings, productConfigs] = await Promise.all([
      this.repository.findCodeOwnersInIntegration(codes, integrationsId, excludeProductId, transaction),
      productConfigService.findGtinOwnersInIntegration(codes, integrationsId, excludeProductId, transaction),
    ]);
    return { supplierMappings, productConfigs };
  }

  // Lista paginada dos SupplierMappings de um produto, escopada na integração do usuário; productId obrigatório.
  findByProductId(
    params: QueryParams,
    productId: string,
    integrationsId: string,
  ): Promise<PaginatedResult<SupplierMapping>> {
    if (!productId) {
      throw new Error("product_id não informado");
    }

    return this.repository.findPaginated(
      params,
      this.queryConfig,
      {
        include: [
          {
            model: Integration,
            as: "integration",
            attributes: ["id", "name"],
          },
        ],
      },
      {
        product_id: productId,
        integrations_id: integrationsId,
      },
    );
  }

  // Cria SupplierMapping pro produto da rota na integração do usuário (validação de código/conflito fica no create).
  async createForProduct(
    productId: string,
    integrationsId: string,
    data: ProductSupplierMappingInput,
  ): Promise<SupplierMapping> {
    try {
      return await this.create({
        product_id: productId,
        integrations_id: integrationsId,
        supplier_product_code: data.supplier_product_code,
        supplier_cnpj: data.supplier_cnpj,
      });
    } catch (error: any) {
      // FK de product_id = produto inexistente (não dá pra checar via productService: import circular).
      if (error instanceof ForeignKeyConstraintError) {
        throw new Error("Produto não encontrado");
      }
      throw error;
    }
  }

  // Atualiza código/CNPJ de um SupplierMapping do produto na integração do usuário; null = não pertence/não existe.
  async updateForProduct(
    id: string,
    productId: string,
    integrationsId: string,
    data: Partial<ProductSupplierMappingInput>,
  ): Promise<SupplierMapping | null> {
    const existing = await this.findOne({
      where: { id, product_id: productId, integrations_id: integrationsId },
      attributes: ["id"],
    });
    if (!existing) return null;

    if (
      data.supplier_product_code !== undefined &&
      !data.supplier_product_code
    ) {
      throw new Error("supplier_product_code não informado");
    }

    // Só manda o que veio no body, pra não zerar campo omitido.
    const changes: Partial<ProductSupplierMappingInput> = {};
    if (data.supplier_product_code !== undefined)
      changes.supplier_product_code = data.supplier_product_code;
    if (data.supplier_cnpj !== undefined)
      changes.supplier_cnpj = data.supplier_cnpj;

    try {
      // repository.update (instância) em vez de bulkUpdate pra rodar o hook beforeUpdate que limpa o CNPJ.
      return await this.repository.update(id, changes);
    } catch (error: any) {
      if (error instanceof UniqueConstraintError) {
        throw new Error(
          `Já existe um SupplierMapping com o código ${changes.supplier_product_code} nessa integração`,
        );
      }
      throw error;
    }
  }

  // Remove um SupplierMapping do produto na integração do usuário; false = não pertence/não existe.
  async deleteForProduct(
    id: string,
    productId: string,
    integrationsId: string,
  ): Promise<boolean> {
    const deleted = await this.bulkDelete({
      where: { id, product_id: productId, integrations_id: integrationsId },
    });
    return deleted > 0;
  }

  async create(
    data: Partial<SupplierMappingCreationAttributes>,
    options?: CreateOptions,
  ): Promise<SupplierMapping> {
    const productCode = data.supplier_product_code;

    if (!productCode) {
      throw new Error("supplier_product_code não informado");
    }

    if (!data.integrations_id) {
      throw new Error("integrations_id não informado");
    }

    // Conflito (código já é gtin de outro produto na mesma integração, ou
    // já existe SupplierMapping com esse código nela) é validado pelo
    // próprio banco — unique index
    // product_supplier_maps_integrations_id_code_unique e o trigger
    // trigger_prevent_supplier_mapping_gtin_conflict — não precisa duplicar
    // a checagem aqui.
    try {
      return await this.repository.create(data, options);
    } catch (error: any) {
      if (error instanceof UniqueConstraintError) {
        throw new Error(
          `Já existe um SupplierMapping com o código ${productCode} nessa integração`,
        );
      }
      throw error;
    }
  }

  // Mapeia manualmente um unmapped pra um product_id JÁ EXISTENTE via
  // SupplierMapping (sem passar por invoice/InvoiceItems) — útil sobretudo
  // pro unmapped de catálogo (invoice_id: null, sem nota associada), onde
  // createInvoiceItemForUnmappedProducts não se aplica. Cria o
  // SupplierMapping com o código de fornecedor do próprio unmapped
  // (ean, com fallback pra sku) e apaga o unmapped em seguida, na mesma
  // transação.
  async createFromUnmapped(params: {
    productId: string;
    unmappedInvoiceProductId: string;
    supplierCnpj?: string;
  }): Promise<SupplierMapping | null> {
    return sequelize.transaction(async (t) => {
      const unmapped = await unmappedInvoiceProductService.findById(
        params.unmappedInvoiceProductId,
        { transaction: t },
      );

      if (!unmapped) {
        throw new Error("Produto não mapeado não encontrado!");
      }

      // ERROR_CATALOG_DUPLICATE: o código é ambíguo por definição (colide
      // com outro produto no catálogo Tecinco) — não faz sentido tentar
      // criar um SupplierMapping pra ele (a validação de conflito
      // bloquearia mesmo). Só cria o integration_mapping (produto Tecinco
      // × produto sistema via external_id, que é sempre único
      // independente da ambiguidade de sku/ean) e apaga o unmapped.
      if (unmapped.type === "ERROR_CATALOG_DUPLICATE") {
        if (!unmapped.integrations_id || !unmapped.external_id) {
          throw new Error(
            "Produto não mapeado duplicado sem integrations_id/external_id, não é possível mapear",
          );
        }
        await integrationMappingService.createOrUpdateIntegrationMapping(
          {
            entity_type: "PRODUCT",
            internal_id: params.productId,
            integrations_id: unmapped.integrations_id,
            external_id: unmapped.external_id,
          },
          t,
        );
        await unmappedInvoiceProductService.delete(unmapped.id, {
          transaction: t,
        });
        return null;
      }

      const supplierProductCode = unmapped.ean ?? unmapped.sku;
      if (!supplierProductCode) {
        throw new Error(
          "Produto não mapeado sem EAN/SKU, não é possível criar o DE X PARA",
        );
      }

      if (!unmapped.integrations_id) {
        throw new Error(
          "Produto não mapeado sem integração associada, não é possível criar o DE X PARA",
        );
      }

      // Se já existe um SupplierMapping com esse código nessa integração
      // apontando pro MESMO produto, é idempotente — não é erro, só não
      // recria (senão estouraria a unique constraint à toa). Só é conflito
      // de verdade quando o código já está mapeado pra um produto
      // DIFERENTE do que está sendo enviado agora.
      const existingMapping = await this.findOne({
        where: {
          integrations_id: unmapped.integrations_id,
          supplier_product_code: supplierProductCode,
        },
        transaction: t,
      });

      let supplierMapping: SupplierMapping;
      if (existingMapping) {
        if (existingMapping.product_id !== params.productId) {
          throw new Error(
            `Já existe um SupplierMapping com o código ${supplierProductCode} nessa integração, mapeado para outro produto (id=${existingMapping.product_id})`,
          );
        }
        supplierMapping = existingMapping;
      } else {
        supplierMapping = await this.create(
          {
            product_id: params.productId,
            supplier_cnpj: params.supplierCnpj,
            supplier_product_code: supplierProductCode,
            integrations_id: unmapped.integrations_id,
          },
          { transaction: t },
        );
      }

      // unmapped de catálogo (invoice_id: null) tem external_id = id real do
      // produto no ERP — se ele existir, aproveita que já temos o par
      // externo/interno aqui e garante o IntegrationMapping também. Sem
      // isso, o próximo sync de catálogo não acharia mapping pra esse
      // external_id (resolveProductWithMapping é mapping-only) e recriaria
      // um unmapped pro mesmo produto, desfazendo esse mapeamento manual.
      // createOrUpdateIntegrationMapping já é idempotente — não sobrescreve
      // se já existir outro mapping pra esse external_id/internal_id.
      if (unmapped.external_id) {
        await integrationMappingService.createOrUpdateIntegrationMapping(
          {
            entity_type: "PRODUCT",
            internal_id: params.productId,
            integrations_id: unmapped.integrations_id,
            external_id: unmapped.external_id,
          },
          t,
        );
      }

      await unmappedInvoiceProductService.delete(unmapped.id, {
        transaction: t,
      });

      return supplierMapping;
    });
  }
}

export default new SupplierMappingService();
