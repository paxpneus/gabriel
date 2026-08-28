import { Op, Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import IntegrationMapping from "./integration-mapping.model";
import integrationMappingRepository, {
  IntegrationMappingRepository,
} from "./integration-mapping.repository";
import {
  IntegrationMappingCreationAttributes,
  EntityType,
  GroupedIntegrationMapping,
} from "./integration-mapping.types";
import { entityRepositoryMap } from "./helpers/map-repository";
import Integration from "../integrations/integrations.model";

export class IntegrationMappingService extends BaseService<
  IntegrationMapping,
  IntegrationMappingRepository
> {
  constructor() {
    super(integrationMappingRepository);
  }

  // Cria o mapeamento de integração de uma entidade — uma única vez. Um
  // mapping já existente (por internal_id OU por external_id) nunca é
  // atualizado, reapontado ou removido por aqui: resoluções automáticas
  // (EAN, SKU, nome, id_system...) já causaram mappings errados sendo
  // silenciosamente reapontados no passado, então a política agora é
  // "criado uma vez pelo sistema, não é mais tocado" — qualquer correção
  // precisa ser deliberada (migration/script manual), não automática.
  async createOrUpdateIntegrationMapping(
    mappingDto: IntegrationMappingCreationAttributes,
    transaction?: Transaction
  ) {
    const { entity_type, integrations_id, internal_id, external_id } = mappingDto;

    const existing = await this.repository.findOne({
      where: {
        entity_type,
        integrations_id,
        [Op.or]: [{ internal_id }, { external_id }],
      },
      transaction,
    });

    if (existing) {
      if (existing.internal_id !== internal_id || existing.external_id !== external_id) {
        console.warn(
          `[IntegrationMappingService] mapping já existe (entity_type=${entity_type}, integrations_id=${integrations_id}, internal_id=${existing.internal_id}, external_id=${existing.external_id}) — ignorando tentativa de reapontar para (internal_id=${internal_id}, external_id=${external_id})`,
        );
      }
      return existing;
    }

    return this.repository.create(mappingDto, { transaction });
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

  async findExternalIdsMap(
    entityType: EntityType,
    integrations_id: string,
    internalIds: string[],
  ): Promise<Map<string, string>> {
    if (!internalIds.length) return new Map();

    const mappings = await this.repository.findAll({
      where: {
        entity_type: entityType,
        integrations_id,
        internal_id: { [Op.in]: internalIds },
      },
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