import integrationErrorService from './integration-error.service';
import { IntegrationErrorEntity } from './integration-error.types';

export interface LogIntegrationEventParams {
  entity: IntegrationErrorEntity;
  type: string;
  integrationsId: string;
  externalId?: string | null;
  internalId?: string | null;
  reference?: string | null;
  message: string;
  // true: falha real, persiste/atualiza linha em integration_errors.
  // false: aviso transiente (ex.: tentativa de retry ainda em andamento),
  // não persiste — só o futuro pino.warn (abaixo) registra.
  createIntegrationError: boolean;
}

class IntegrationLoggerService {
  async log(params: LogIntegrationEventParams): Promise<void> {
    // futuro: pino.warn/error(params) incondicional, antes do if abaixo.

    if (!params.createIntegrationError) return;

    await integrationErrorService.recordError({
      entity: params.entity,
      type: params.type,
      integrationsId: params.integrationsId,
      externalId: params.externalId,
      internalId: params.internalId,
      reference: params.reference,
      message: params.message,
    });
  }
}

export default new IntegrationLoggerService();
