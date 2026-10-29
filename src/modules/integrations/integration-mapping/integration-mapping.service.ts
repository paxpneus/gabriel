import { ForeignKeyConstraintError, Op, Transaction, UniqueConstraintError } from "sequelize";
import sequelize from "../../../config/sequelize";
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
  ProductIntegrationMappingSummary,
  ProductErpData,
  ErpCodeRow,
  ProductWithMultipleCodes,
} from "./integration-mapping.types";
import { entityRepositoryMap } from "./helpers/map-repository";
import Integration from "../integrations/integrations.model";
import productService from "../../inventory/products/services/product.service";
import { QueryParams, PaginatedResult } from "../../../shared/query/query.types";
import auditLogService from "../../global/audit-logs/audit-log.service";
import { AuditAction, AuditAffectedEntity, AuditEntity } from "../../global/audit-logs/audit-log.types";
import userService from "../../company/users/users/user.service";
import manualImportService from "../manual-import/manual-import.service";
import type { ManualImportQueues } from "../manual-import/manual-import.types";

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

    // Primeiro mapping da entidade nessa integração nasce principal; os seguintes, só leitura.
    const is_primary = !(await this.hasPrimary(entity_type, internal_id, integrations_id, transaction));
    return this.repository.create({ ...mappingDto, is_primary }, { transaction });
  }

  // true se a entidade já tem um mapping principal nessa integração.
  private async hasPrimary(
    entityType: EntityType,
    internalId: string,
    integrationsId: string,
    transaction?: Transaction,
  ): Promise<boolean> {
    const primary = await this.repository.findOne({
      where: { entity_type: entityType, internal_id: internalId, integrations_id: integrationsId, is_primary: true },
      attributes: ["id"],
      transaction,
    });
    return !!primary;
  }

  // Sem principal nessa integração (o principal foi apagado/movido): promove o mapping mais antigo que sobrou.
  private async promoteOldestIfNoPrimary(
    internalId: string,
    integrationsId: string,
    transaction: Transaction,
  ): Promise<IntegrationMapping | null> {
    if (await this.hasPrimary("PRODUCT", internalId, integrationsId, transaction)) return null;

    const oldest = await this.repository.findOne({
      where: { entity_type: "PRODUCT", internal_id: internalId, integrations_id: integrationsId },
      attributes: ["id", "external_id"],
      order: [["createdAt", "ASC"]],
      transaction,
    });
    if (oldest) {
      await this.repository.bulkUpdate({ is_primary: true }, { where: { id: oldest.id }, transaction });
    }
    return oldest;
  }

  // Mapping PRODUCT de um external_id (id + produto + is_primary) — usado pelo sync pra decidir se grava dados.
  findProductMappingByExternalId(
    integrationsId: string,
    externalId: string,
    transaction?: Transaction,
  ): Promise<IntegrationMapping | null> {
    return this.repository.findOne({
      where: { entity_type: "PRODUCT", integrations_id: integrationsId, external_id: externalId },
      attributes: ["id", "internal_id", "is_primary"],
      transaction,
    });
  }

  // EAN ou SKU que o ERP manda (erp_data) em TODOS os mappings PRODUCT da integração, principal e não principal, com o
  // nome do produto — base do relatório de pendências. `missing`: só os já sincronizados (erp_data presente) SEM o campo.
  async findErpCodesInIntegration(
    integrationsId: string,
    field: "ean" | "sku",
    missing = false,
  ): Promise<ErpCodeRow[]> {
    const mappings = (await this.repository.findProductErpCodes(integrationsId, field, missing)) as unknown as Array<{
      internal_id: string;
      external_id: string;
      is_primary: boolean;
      code: string | null;
    }>;
    if (!mappings.length) return [];

    const products = await productService.findAll({
      where: { id: { [Op.in]: [...new Set(mappings.map((m) => m.internal_id))] } },
      attributes: ["id", "name"],
    });
    const names = new Map(products.map((p) => [p.id, p.name]));

    return mappings.map((m) => ({
      product_id: m.internal_id,
      product_name: names.get(m.internal_id) ?? null,
      external_id: m.external_id,
      is_primary: !!m.is_primary,
      code: m.code,
    }));
  }

  // Produtos com 2+ códigos na integração (mesmo produto físico com cadastros duplicados no ERP), códigos do mais
  // antigo pro mais novo com nome/EAN/SKU do snapshot do ERP — base do relatório de pendências.
  async findProductsWithMultipleCodes(integrationsId: string): Promise<ProductWithMultipleCodes[]> {
    const mappings = (await this.repository.findProductMappingsWithMultipleCodes(integrationsId)) as unknown as Array<{
      internal_id: string;
      external_id: string;
      is_primary: boolean;
      synced: boolean;
      erp_name: string | null;
      erp_ean: string | null;
      erp_sku: string | null;
    }>;
    if (!mappings.length) return [];

    const products = await productService.findAll({
      where: { id: { [Op.in]: [...new Set(mappings.map((m) => m.internal_id))] } },
      attributes: ["id", "name"],
    });
    const names = new Map(products.map((p) => [p.id, p.name]));

    const byProduct = new Map<string, ProductWithMultipleCodes>();
    for (const m of mappings) {
      const entry = byProduct.get(m.internal_id) ?? {
        product_id: m.internal_id,
        product_name: names.get(m.internal_id) ?? null,
        codes: [],
      };
      let erpData: ProductWithMultipleCodes["codes"][number]["erp_data"] = null;
      if (m.synced) erpData = { name: m.erp_name, ean: m.erp_ean, sku: m.erp_sku };
      entry.codes.push({ external_id: m.external_id, is_primary: !!m.is_primary, erp_data: erpData });
      byProduct.set(m.internal_id, entry);
    }
    return [...byProduct.values()];
  }

  // Código principal excluído/desativado no ERP, mas o produto tem outro código na mesma integração (cadastro duplicado
  // sendo limpo no ERP): remove só esse código e promove o próximo. true = era o caso (o chamador NÃO aposenta o produto).
  async retirePrimaryCodeIfDuplicated(mappingId: string, productId: string, integrationsId: string): Promise<boolean> {
    const sibling = await this.repository.findOne({
      where: { entity_type: "PRODUCT", internal_id: productId, integrations_id: integrationsId, id: { [Op.ne]: mappingId } },
      attributes: ["id"],
    });
    if (!sibling) return false;
    await this.deleteForProduct(mappingId, productId);
    return true;
  }

  // external_id → { produto local, é principal } dos códigos PRODUCT informados na integração, numa query.
  async findProductMappingsByExternalIds(
    integrationsId: string,
    externalIds: string[],
  ): Promise<Map<string, { internal_id: string; is_primary: boolean }>> {
    if (!externalIds.length) return new Map();
    const mappings = await this.repository.findAll({
      where: { entity_type: "PRODUCT", integrations_id: integrationsId, external_id: { [Op.in]: externalIds } },
      attributes: ["external_id", "internal_id", "is_primary"],
    });
    return new Map(mappings.map((m) => [m.external_id, { internal_id: m.internal_id, is_primary: !!m.is_primary }]));
  }

  // Grava o snapshot só-leitura do ERP no mapping (principal ou não) — não auditado, é escrita de sync.
  async updateErpData(
    mappingId: string,
    erpData: ProductErpData,
    transaction?: Transaction,
  ): Promise<void> {
    await this.repository.bulkUpdate({ erp_data: erpData }, { where: { id: mappingId }, transaction });
  }

  // Todos os mappings PRODUCT do produto numa integração (mais antigo primeiro), com nome/EAN do snapshot do ERP.
  async findProductMappingsInIntegration(
    productId: string,
    integrationsId: string,
    transaction?: Transaction,
  ): Promise<ProductIntegrationMappingSummary[]> {
    const mappings = await this.repository.findAll({
      where: { entity_type: "PRODUCT", internal_id: productId, integrations_id: integrationsId },
      attributes: ["id", "external_id", "is_primary", "erp_data"],
      order: [["createdAt", "ASC"]],
      transaction,
    });

    return mappings.map((m) => {
      let erpData: ProductIntegrationMappingSummary["erp_data"] = null;
      if (m.erp_data) erpData = { name: m.erp_data.name ?? null, ean: m.erp_data.ean ?? null };
      return { id: m.id, external_id: m.external_id, is_primary: !!m.is_primary, erp_data: erpData };
    });
  }

  // Lista paginada dos mappings de um produto (entity_type PRODUCT, internal_id = productId); productId obrigatório.
  findByProductId(
    params: QueryParams,
    productId: string,
  ): Promise<PaginatedResult<IntegrationMapping>> {
    if (!productId) {
      throw new Error("product_id não informado");
    }

    return this.repository.findPaginated(params, this.queryConfig, {
      include: [
        {
          model: Integration,
          as: 'integration',
          attributes: ['id', 'name']
        }
      ]
    }, {
      entity_type: "PRODUCT",
      internal_id: productId,
    });
  }

  // Cria mapping PRODUCT manual pro produto; checa o produto antes porque internal_id não é FK (evita mapping órfão).
  // Com userId: a integração tem que ser de uma loja do usuário, e a criação é auditada (mapping + produto).
  async createForProduct(
    productId: string,
    data: ProductIntegrationMappingInput,
    userId: string | null = null,
  ): Promise<IntegrationMapping> {
    if (!data.integrations_id || !data.external_id) {
      throw new Error("integrations_id e external_id são obrigatórios");
    }
    if (userId) await userService.assertIntegrationAccess(userId, data.integrations_id);

    const product = await productService.findById(productId, { attributes: ["id"] });
    if (!product) {
      throw new Error("Produto não encontrado");
    }

    try {
      return await sequelize.transaction(async (transaction) => {
        const record = await this.repository.create(
          {
            entity_type: "PRODUCT",
            internal_id: productId,
            integrations_id: data.integrations_id,
            external_id: data.external_id,
            // Primeiro mapping do produto nessa integração nasce principal.
            is_primary: !(await this.hasPrimary("PRODUCT", productId, data.integrations_id, transaction)),
          },
          { transaction },
        );
        await this.recordProductMappingAudit(
          userId,
          productId,
          record.id,
          AuditAction.CREATE,
          `O código ${record.external_id} no ERP foi vinculado ao produto`,
          null,
          { external_id: record.external_id, is_primary: record.is_primary },
          transaction,
        );
        return record;
      });
    } catch (error: any) {
      throw this.toProductMappingError(error);
    }
  }

  // Troca integração/external_id de um mapping do produto (internal_id fica fixo); null = não pertence/não existe.
  // is_primary: true marca este como principal e desmarca os outros do produto na mesma integração. Tudo auditado.
  // Código/integração mudou → erp_data zera (era de outro código). Ficou principal com código novo → enfileira o sync
  // dele na integração (com `queues`) sem segurar a resposta.
  async updateForProduct(
    id: string,
    productId: string,
    data: Partial<ProductIntegrationMappingInput>,
    userId?: string | null,
    queues?: ManualImportQueues,
  ): Promise<IntegrationMapping | null> {
    const existing = await this.repository.findOne({
      where: { id, entity_type: "PRODUCT", internal_id: productId },
      attributes: ["id", "integrations_id", "external_id", "is_primary"],
    });
    if (!existing) return null;

    if (
      (data.integrations_id !== undefined && !data.integrations_id) ||
      (data.external_id !== undefined && !data.external_id)
    ) {
      throw new Error("integrations_id/external_id não podem ser vazios");
    }
    // Só booleano: "false" (string) seria truthy e viraria "tornar principal".
    if (data.is_primary !== undefined && typeof data.is_primary !== "boolean") {
      throw new Error("is_primary deve ser true ou false");
    }
    if (data.is_primary === false) {
      throw new Error("Para trocar o principal, marque outro mapping como principal");
    }

    // Só manda o que veio no body, pra não zerar campo omitido.
    const changes: Partial<ProductIntegrationMappingInput> & { erp_data?: null } = {};
    if (data.integrations_id !== undefined) changes.integrations_id = data.integrations_id;
    if (data.external_id !== undefined) changes.external_id = data.external_id;

    const targetIntegrationsId = changes.integrations_id ?? existing.integrations_id;
    const movedIntegration = targetIntegrationsId !== existing.integrations_id;
    const codeChanged =
      movedIntegration || (changes.external_id !== undefined && changes.external_id !== existing.external_id);
    const externalId = changes.external_id ?? existing.external_id;

    if (userId) {
      await userService.assertIntegrationAccess(userId, existing.integrations_id);
      if (movedIntegration) await userService.assertIntegrationAccess(userId, targetIntegrationsId);
    }
    // Snapshot do ERP era do código antigo — o próximo sync do código novo regrava.
    if (codeChanged) changes.erp_data = null;

    let updated: IntegrationMapping | null;
    try {
      updated = await sequelize.transaction(async (transaction) => {
        let unmarked: Array<{ id: string; external_id: string }> = [];
        // Já é o principal na mesma integração: nada a trocar.
        if (data.is_primary && !(existing.is_primary && !movedIntegration)) {
          unmarked = await this.repository.findAll({
            where: {
              entity_type: "PRODUCT",
              internal_id: productId,
              integrations_id: targetIntegrationsId,
              is_primary: true,
              id: { [Op.ne]: id },
            },
            attributes: ["id", "external_id"],
            transaction,
          });
          await this.repository.bulkUpdate(
            { is_primary: false },
            { where: { id: { [Op.in]: unmarked.map((m) => m.id) } }, transaction },
          );
          changes.is_primary = true;
        } else if (movedIntegration) {
          // Mudou de integração sem pedir principal: só vira principal lá se a integração destino não tiver um.
          changes.is_primary = !(await this.hasPrimary("PRODUCT", productId, targetIntegrationsId, transaction));
        }

        const record = await this.repository.update(id, changes, { transaction });

        // O principal saiu da integração antiga: promove o mais antigo que sobrou lá.
        let promoted: IntegrationMapping | null = null;
        if (movedIntegration && existing.is_primary) {
          promoted = await this.promoteOldestIfNoPrimary(productId, existing.integrations_id, transaction);
        }

        if (changes.is_primary === true || codeChanged) {
          let summary = `O código ${existing.external_id} no ERP foi trocado para ${externalId}`;
          if (changes.is_primary === true && !existing.is_primary) {
            summary = `O código ${externalId} no ERP passou a ser o mapeamento principal do produto nessa integração`;
          }
          // Desmarcados (deixaram de ser principal) + promovido na integração antiga (virou principal).
          const toAffected = (m: { id: string; external_id: string }, becamePrimary: boolean): AuditAffectedEntity => ({
            entity: AuditEntity.INTEGRATION_MAPPING,
            internal_id: m.id,
            action: AuditAction.UPDATE,
            label: `(código ${m.external_id} no ERP)`,
            before: { is_primary: !becamePrimary },
            after: { is_primary: becamePrimary },
          });
          const affected = unmarked.map((m) => toAffected(m, false));
          if (promoted) affected.push(toAffected(promoted, true));
          await this.recordProductMappingAudit(
            userId ?? null,
            productId,
            id,
            AuditAction.UPDATE,
            summary,
            { external_id: existing.external_id, integrations_id: existing.integrations_id, is_primary: existing.is_primary },
            { external_id: externalId, integrations_id: targetIntegrationsId, is_primary: changes.is_primary ?? existing.is_primary },
            transaction,
            affected,
          );
        }

        return record;
      });
    } catch (error: any) {
      throw this.toProductMappingError(error);
    }

    // Depois do commit, sem await: a busca na API do ERP + enqueue não seguram a resposta e falha só fica no log
    // (a troca vale do mesmo jeito; o sync agendado corrige depois).
    const isPrimaryAfter = changes.is_primary ?? existing.is_primary;
    if (queues && isPrimaryAfter && (changes.is_primary === true || codeChanged)) {
      void manualImportService
        .enqueueProductSync(targetIntegrationsId, externalId, queues)
        .then((jobRef) => {
          if (!jobRef) {
            console.warn(`[INTEGRATION_MAPPING] principal trocado, mas o código ${externalId} não foi achado na integração ${targetIntegrationsId} — sync não enfileirado`);
          }
        })
        .catch((error: any) => {
          console.warn(`[INTEGRATION_MAPPING] principal trocado, mas falhou ao enfileirar o sync do código ${externalId}: ${error?.message}`);
        });
    }

    return updated;
  }

  // Remove um mapping do produto; false = não pertence/não existe. Auditado (com a promoção, se houver).
  // Se era o principal, promove o mais antigo que sobrou na mesma integração (senão o produto pararia de sincronizar).
  async deleteForProduct(id: string, productId: string, userId: string | null = null): Promise<boolean> {
    const existing = await this.repository.findOne({
      where: { id, entity_type: "PRODUCT", internal_id: productId },
      attributes: ["id", "integrations_id", "external_id", "is_primary"],
    });
    if (!existing) return false;
    if (userId) await userService.assertIntegrationAccess(userId, existing.integrations_id);

    return sequelize.transaction(async (transaction) => {
      await this.repository.bulkDelete({ where: { id }, transaction });
      let promoted: IntegrationMapping | null = null;
      if (existing.is_primary) {
        promoted = await this.promoteOldestIfNoPrimary(productId, existing.integrations_id, transaction);
      }

      let affected: AuditAffectedEntity[] = [];
      if (promoted) {
        affected = [
          {
            entity: AuditEntity.INTEGRATION_MAPPING,
            internal_id: promoted.id,
            action: AuditAction.UPDATE,
            label: `(código ${promoted.external_id} no ERP)`,
            before: { is_primary: false },
            after: { is_primary: true },
          },
        ];
      }
      await this.recordProductMappingAudit(
        userId,
        productId,
        id,
        AuditAction.DELETE,
        `O código ${existing.external_id} no ERP foi desvinculado do produto`,
        { external_id: existing.external_id, is_primary: existing.is_primary },
        null,
        transaction,
        affected,
      );
      return true;
    });
  }

  // Grava a entrada do mapeamento + a do produto (o histórico do produto mostra a mudança inteira).
  private async recordProductMappingAudit(
    userId: string | null,
    productId: string,
    mappingId: string,
    action: AuditAction,
    summary: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    transaction: Transaction,
    affected: AuditAffectedEntity[] = [],
  ): Promise<void> {
    await auditLogService.record(
      [
        {
          userId,
          entity: AuditEntity.INTEGRATION_MAPPING,
          internalId: mappingId,
          action,
          changes: { summary, before, after, affected },
        },
        {
          userId,
          entity: AuditEntity.PRODUCT,
          internalId: productId,
          action: AuditAction.UPDATE,
          changes: {
            summary,
            affected: [
              { entity: AuditEntity.INTEGRATION_MAPPING, internal_id: mappingId, action, before, after },
              ...affected,
            ],
          },
        },
      ],
      transaction,
    );
  }

  // Traduz violação do unique (entity_type, integrations_id, external_id), do principal único e FK de integração.
  private toProductMappingError(error: any): Error {
    if (error instanceof UniqueConstraintError) {
      // Índice parcial do principal: outra troca de principal ganhou a corrida.
      if (String((error as any).parent?.constraint ?? "").includes("primary")) {
        return new Error("Outro mapeamento virou principal ao mesmo tempo. Recarregue e tente de novo");
      }
      return new Error("Esse código no ERP já está vinculado a outro produto nessa integração");
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
      attributes: ["internal_id", "external_id", "is_primary"],
      // Principal por último: com mais de um mapping na integração, o Map fica com o external_id do principal.
      order: [["is_primary", "ASC"]],
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