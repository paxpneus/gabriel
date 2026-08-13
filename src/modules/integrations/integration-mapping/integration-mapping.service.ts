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

  //Cria ou atualiza o mapeamento de integração de alguma entidade de alguma integração
  async createOrUpdateIntegrationMapping(
    mappingDto: IntegrationMappingCreationAttributes,
    transaction?: Transaction
  ) {
    await this.repository.upsertByFind(
      {
          external_id: mappingDto.external_id,
          internal_id: mappingDto.internal_id,
          entity_type: mappingDto.entity_type,
          integrations_id: mappingDto.integrations_id
      },
      mappingDto,
      mappingDto,
      {transaction}
    );
  }

  // Acha alguma entidade pelo external_id de alguma integração
   async findEntityByMapping(
    entityType: EntityType,
    integrations_id: string,
    external_id: string
  ) {
    const mapping = await this.repository.findOne({
      where: { entity_type: entityType, integrations_id, external_id },
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