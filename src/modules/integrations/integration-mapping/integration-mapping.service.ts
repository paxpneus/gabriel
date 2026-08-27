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
    const { entity_type, integrations_id, internal_id, external_id } = mappingDto;

    // Esse produto/entidade já tem mapping pra essa integração (talvez com
    // outro external_id — ex.: a Tecinco reatribuiu o código do produto)?
    // Reaponta em vez de deixar criar um segundo mapping pro mesmo produto,
    // que antes passava batido (external_id novo nunca colide com o índice
    // único, então nada acusava a duplicação).
    const existingByInternalId = await this.repository.findOne({
      where: { entity_type, integrations_id, internal_id },
      transaction,
    });

    if (existingByInternalId) {
      if (existingByInternalId.external_id !== external_id) {
        await existingByInternalId.update(mappingDto, { transaction });
      }
      return;
    }

    try {
      await this.repository.upsertByFind(
        { external_id, internal_id, entity_type, integrations_id },
        mappingDto,
        mappingDto,
        { transaction },
      );
    } catch (error: any) {
      if (error?.name !== "SequelizeUniqueConstraintError") throw error;

      // O findOne acima filtra também por internal_id, então não encontra um
      // mapping já existente para (entity_type, integrations_id, external_id)
      // que aponte para outro internal_id — e o create() colide com o índice
      // único dessas 3 colunas. Nesse caso o mapping já existe, só precisa
      // ser reapontado para o internal_id novo.
      const existingByExternalId = await this.repository.findOne({
        where: { entity_type, integrations_id, external_id },
        transaction,
      });

      if (!existingByExternalId) throw error;

      await existingByExternalId.update(mappingDto, { transaction });
    }
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