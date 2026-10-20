import { ForeignKeyConstraintError, Op, Transaction, UniqueConstraintError } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import IntegrationMapping from "./integration-mapping.model";
import integrationMappingRepository, {
  IntegrationMappingRepository,
} from "./integration-mapping.repository";
import {
  IntegrationMappingCreationAttributes,
  EntityType,
  GroupedIntegrationMapping,
  ProductIntegrationMappingInput,
} from "./integration-mapping.types";
import { entityRepositoryMap } from "./helpers/map-repository";
import Integration from "../integrations/integrations.model";
import productService from "../../inventory/products/services/product.service";
import { QueryParams, PaginatedResult } from "../../../shared/query/query.types";

export class IntegrationMappingService extends BaseService<
  IntegrationMapping,
  IntegrationMappingRepository
> {
  constructor() {
    super(integrationMappingRepository);
  }

  // Cria o mapeamento de integração de uma entidade. Um external_id já
  // mapeado nunca é reapontado pra outro internal_id (resoluções
  // automáticas — EAN, SKU, nome, id_system... — já causaram mappings
  // errados sendo silenciosamente reapontados no passado); qualquer
  // correção disso precisa ser deliberada (migration/script manual), não
  // automática. Mas um mesmo internal_id PODE ter várias linhas nessa
  // integração — normal na Tecinco, que reaproveita/duplica epctb_codigo
  // entre filiais/cadastros pro mesmo produto físico — então só bloqueia
  // por external_id, nunca por internal_id sozinho.
  async createOrUpdateIntegrationMapping(
    mappingDto: IntegrationMappingCreationAttributes,
    transaction?: Transaction
  ) {
    const { entity_type, integrations_id, internal_id, external_id } = mappingDto;

    const existing = await this.repository.findOne({
      where: { entity_type, integrations_id, external_id },
      transaction,
    });

    if (existing) {
      if (existing.internal_id !== internal_id) {
        console.warn(
          `[IntegrationMappingService] external_id=${external_id} já mapeado (entity_type=${entity_type}, integrations_id=${integrations_id}) pro internal_id=${existing.internal_id} — ignorando tentativa de reapontar para internal_id=${internal_id}`,
        );
      }
      return existing;
    }

    return this.repository.create(mappingDto, { transaction });
  }

  // Lista paginada dos mappings de um produto (entity_type PRODUCT, internal_id = productId); productId obrigatório.
  findByProductId(
    params: QueryParams,
    productId: string,
  ): Promise<PaginatedResult<IntegrationMapping>> {
    if (!productId) {
      throw new Error("product_id não informado");
    }

    return this.repository.findPaginated(params, this.queryConfig, {}, {
      entity_type: "PRODUCT",
      internal_id: productId,
    });
  }

  // Cria mapping PRODUCT manual pro produto; checa o produto antes porque internal_id não é FK (evita mapping órfão).
  async createForProduct(
    productId: string,
    data: ProductIntegrationMappingInput,
  ): Promise<IntegrationMapping> {
    if (!data.integrations_id || !data.external_id) {
      throw new Error("integrations_id e external_id são obrigatórios");
    }

    const product = await productService.findById(productId, { attributes: ["id"] });
    if (!product) {
      throw new Error("Produto não encontrado");
    }

    try {
      return await this.repository.create({
        entity_type: "PRODUCT",
        internal_id: productId,
        integrations_id: data.integrations_id,
        external_id: data.external_id,
      });
    } catch (error: any) {
      throw this.toProductMappingError(error);
    }
  }

  // Troca integração/external_id de um mapping do produto (internal_id fica fixo); null = não pertence/não existe.
  async updateForProduct(
    id: string,
    productId: string,
    data: Partial<ProductIntegrationMappingInput>,
  ): Promise<IntegrationMapping | null> {
    const existing = await this.repository.findOne({
      where: { id, entity_type: "PRODUCT", internal_id: productId },
      attributes: ["id"],
    });
    if (!existing) return null;

    if (
      (data.integrations_id !== undefined && !data.integrations_id) ||
      (data.external_id !== undefined && !data.external_id)
    ) {
      throw new Error("integrations_id/external_id não podem ser vazios");
    }

    // Só manda o que veio no body, pra não zerar campo omitido.
    const changes: Partial<ProductIntegrationMappingInput> = {};
    if (data.integrations_id !== undefined) changes.integrations_id = data.integrations_id;
    if (data.external_id !== undefined) changes.external_id = data.external_id;

    try {
      return await this.repository.update(id, changes);
    } catch (error: any) {
      throw this.toProductMappingError(error);
    }
  }

  // Remove um mapping do produto; false = não pertence/não existe.
  async deleteForProduct(id: string, productId: string): Promise<boolean> {
    const deleted = await this.repository.bulkDelete({
      where: { id, entity_type: "PRODUCT", internal_id: productId },
    });
    return deleted > 0;
  }

  // Traduz violação do unique (entity_type, integrations_id, external_id) e FK de integração pra mensagem legível.
  private toProductMappingError(error: any): Error {
    if (error instanceof UniqueConstraintError) {
      return new Error("Esse external_id já está mapeado nessa integração");
    }
    if (error instanceof ForeignKeyConstraintError) {
      return new Error("Integração não encontrada");
    }
    return error;
  }

  // Acha alguma entidade pelo external_id de alguma integração
   async findEntityByMapping(
    entityType: EntityType,
    integrations_id: string,
    external_id: string
  ) {
    const mapping = await this.repository.findOne({
      where: { entity_type: entityType, integrations_id, external_id },
      order: [["updatedAt", "DESC"]],
    });

    if (!mapping) return null;

    const repository = entityRepositoryMap[entityType];
    return repository.findById(mapping.internal_id);
  }

  // Pra decidir, em lote, quais external_id (ex.: todo o catálogo Tecinco
  // de uma sincronização) já têm um mapeamento VÁLIDO — não basta existir a
  // linha em integration_mappings, ela pode ser órfã (internal_id sem
  // Product correspondente, ver histórico de mapeamentos órfãos em
  // CLAUDE.md). Só entity_type PRODUCT por enquanto (usa productService
  // direto pra checar a existência em lote) — generalizar pra outros tipos
  // se algum outro caller precisar.
  async findValidExternalIdsSet(
    integrations_id: string,
  ): Promise<Set<string>> {
    const mappings = await this.repository.findAll({
      where: { entity_type: "PRODUCT", integrations_id },
      attributes: ["external_id", "internal_id"],
    });
    if (!mappings.length) return new Set();

    const internalIds = [...new Set(mappings.map((m) => m.internal_id))];
    const existingProducts = await productService.findAll({
      where: { id: { [Op.in]: internalIds } },
      attributes: ["id"],
    });
    const existingProductIds = new Set(existingProducts.map((p) => p.id));

    return new Set(
      mappings
        .filter((m) => existingProductIds.has(m.internal_id))
        .map((m) => m.external_id),
    );
  }

  async findExternalIdsMap(
    entityType: EntityType,
    integrations_id: string,
    internalIds: string[],
    transaction?: Transaction,
  ): Promise<Map<string, string>> {
    if (!internalIds.length) return new Map();

    const mappings = await this.repository.findAll({
      where: {
        entity_type: entityType,
        integrations_id,
        internal_id: { [Op.in]: internalIds },
      },
      transaction,
    });

    return new Map(mappings.map((m) => [m.internal_id, m.external_id]));
  }

  // Retorna, para cada internal_id, todas as integrações (nome + external_id) mapeadas
  async findGroupedMappingsMap(
    entityType: EntityType,
    internalIds: string[],
  ): Promise<Map<string, GroupedIntegrationMapping[]>> {
    const map = new Map<string, GroupedIntegrationMapping[]>();

    if (!internalIds.length) return map;

    const mappings = await this.repository.findAll({
      where: {
        entity_type: entityType,
        internal_id: { [Op.in]: internalIds },
      },
      attributes: ["entity_type", "external_id", "internal_id"],
      include: [
        {
          model: Integration,
          as: "integration",
          attributes: ["name"],
          required: true,
        },
      ],
    });

    for (const mapping of mappings as any[]) {
      const list = map.get(mapping.internal_id) ?? [];
      list.push({
        integration_name: mapping.integration.name,
        integration_id: mapping.external_id,
      });
      map.set(mapping.internal_id, list);
    }

    return map;
  }

}

export default new IntegrationMappingService();