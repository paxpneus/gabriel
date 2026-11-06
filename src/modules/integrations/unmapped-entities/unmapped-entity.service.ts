import { Op } from "sequelize";
import sequelize from "../../../config/sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import UnmappedEntity from "./unmapped-entity.model";
import unmappedEntityRepository, {
  UnmappedEntityRepository,
} from "./unmapped-entity.repository";
import { EntityType } from "../integration-mapping/integration-mapping.types";
import integrationMappingService from "../integration-mapping/integration-mapping.service";
import IntegrationMapping from "../integration-mapping/integration-mapping.model";
import auditLogService from "../../global/audit-logs/audit-log.service";
import userService from "../../company/users/users/user.service";
import { unmappedEntityMappedAudit } from "./helpers/audit";

export class UnmappedEntityService extends BaseService<
  UnmappedEntity,
  UnmappedEntityRepository
> {
  constructor() {
    super(unmappedEntityRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["description", "external_id"],
      filterableFields: ["entity", "integrations_id", "external_id"],
      sortableFields: ["entity", "description", "createdAt"],
    };
  }

  // Registra as pendências numa query só; já pendente → só atualiza a descrição (sync repetido não duplica).
  async registerMany(
    entity: EntityType,
    integrationsId: string,
    items: { externalId: string; description: string | null }[],
  ): Promise<void> {
    if (!items.length) return;
    await this.repository.bulkCreate(
      items.map((item) => ({
        entity,
        integrations_id: integrationsId,
        external_id: item.externalId,
        description: item.description,
      })),
      {
        updateOnDuplicate: ["description", "updatedAt"],
        conflictAttributes: ["entity", "integrations_id", "external_id"],
      },
    );
  }

  // Tira as pendências de códigos que passaram a ter mapping por outro caminho (ex.: auto-mapeados pelo sync).
  async removeMany(
    entity: EntityType,
    integrationsId: string,
    externalIds: string[],
  ): Promise<void> {
    if (!externalIds.length) return;
    await this.repository.bulkDelete({
      where: { entity, integrations_id: integrationsId, external_id: { [Op.in]: externalIds } },
    });
  }

  // Mapeia a pendência pra uma entidade do sistema: cria o integration_mapping, apaga a pendência e audita.
  // null = pendência não existe. Com userId, a integração tem que ser de uma loja do usuário.
  async map(
    id: string,
    internalId: string,
    userId: string | null,
  ): Promise<IntegrationMapping | null> {
    const pending = await this.repository.findById(id, {
      attributes: ["id", "entity", "external_id", "integrations_id", "description"],
    });
    if (!pending) return null;
    if (userId) await userService.assertIntegrationAccess(userId, pending.integrations_id);

    return sequelize.transaction(async (transaction) => {
      const mapping = await integrationMappingService.createForExistingEntity(
        {
          entity_type: pending.entity,
          integrations_id: pending.integrations_id,
          external_id: pending.external_id,
          internal_id: internalId,
          // Só o nome que veio na pendência; o sync completa o resto (tipo, parcelas, bandeira).
          erp_data: { name: pending.description, updated_at: new Date().toISOString() },
        },
        transaction,
      );
      await this.repository.delete(pending.id, { transaction });
      await auditLogService.record(
        unmappedEntityMappedAudit({
          userId,
          entity: pending.entity,
          description: pending.description,
          mapping,
        }),
        transaction,
      );
      return mapping;
    });
  }
}

export default new UnmappedEntityService();
