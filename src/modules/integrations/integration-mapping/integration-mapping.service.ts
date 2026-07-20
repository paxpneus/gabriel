import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import IntegrationMapping from "./integration-mapping.model";
import integrationMappingRepository, {
  IntegrationMappingRepository,
} from "./integration-mapping.repository";
import {
  IntegrationMappingCreationAttributes,
  EntityType,
} from "./integration-mapping.types";
import { entityRepositoryMap } from "./helpers/map-repository";

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
    this.repository.upsertByFind(
      {
        where: {
          external_id: mappingDto.external_id,
          internal_id: mappingDto.internal_id,
          entity_type: mappingDto.entity_type,
          integrations_id: mappingDto.integrations_id
        },
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

}

export default new IntegrationMappingService();
