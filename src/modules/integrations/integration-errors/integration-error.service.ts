import { literal } from 'sequelize';
import BaseService from '../../../shared/utils/base-models/base-service';
import IntegrationError from './integration-error.model';
import integrationErrorRepository, {
  IntegrationErrorRepository,
} from './integration-error.repository';
import { IntegrationErrorEntity } from './integration-error.types';
import eventService from '../../company/events/event/event.service';
import { DEVELOPER_USER_TYPE } from '../../../shared/constants/user-types';

export interface RecordIntegrationErrorParams {
  entity: IntegrationErrorEntity;
  type: string;
  integrationsId: string;
  externalId?: string | null;
  internalId?: string | null;
  reference?: string | null;
  message?: string | null;
}

export class IntegrationErrorService extends BaseService<
  IntegrationError,
  IntegrationErrorRepository
> {
  constructor() {
    super(integrationErrorRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: 'last_seen_at', sortDir: 'DESC' },
      searchFields: ['reference', 'message', 'external_id', 'internal_id'],
      filterableFields: ['entity', 'type', 'integrations_id', 'resolved', 'external_id', 'internal_id'],
      sortableFields: ['entity', 'type', 'occurrences', 'last_seen_at', 'resolved'],
    };
  }

  // Achou o mesmo erro (entity+type+integração+internal_id/external_id) de
  // novo: soma occurrences e reabre (resolved:false) se já tinha sido
  // marcado resolvido — reincidência depois de "resolvido" significa que o
  // problema voltou. Não achou: cria a linha do zero.
  async recordError(params: RecordIntegrationErrorParams): Promise<IntegrationError> {
    const where = {
      entity: params.entity,
      type: params.type,
      integrations_id: params.integrationsId,
      external_id: params.externalId ?? null,
      internal_id: params.internalId ?? null,
    };

    const existing = await this.repository.findOne({ where });

    const record = await this.repository.upsertByFind(
      where,
      {
        reference: params.reference ?? null,
        message: params.message ?? null,
        occurrences: literal('occurrences + 1') as unknown as number,
        last_seen_at: new Date(),
        resolved: false,
        resolved_at: null,
      },
      {
        ...where,
        reference: params.reference ?? null,
        message: params.message ?? null,
        occurrences: 1,
        last_seen_at: new Date(),
      },
    );

    // Já existe um evento pra essa combinação de dedup — reincidência
    // (occurrences++ acima) não deve disparar notificação de novo. Só
    // notifica na primeira ocorrência (ou se uma ocorrência anterior não
    // tiver conseguido criar o evento, ex.: nenhum usuário developer
    // cadastrado ainda naquele momento).
    if (existing?.event_id) return record;

    const { eventId } = await eventService.notifyByRoles({
      types: [DEVELOPER_USER_TYPE],
      title: `Novo erro de integração: ${params.entity}/${params.type}`,
      description: params.message ?? params.reference ?? undefined,
    });

    if (eventId) {
      const updated = await this.repository.update(record.id, { event_id: eventId });
      return updated ?? record;
    }

    return record;
  }

  async resolve(id: string): Promise<IntegrationError | null> {
    return this.update(id, {
      resolved: true,
      resolved_at: new Date(),
    });
  }
}

export default new IntegrationErrorService();
