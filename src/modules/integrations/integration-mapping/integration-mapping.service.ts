import BaseService from '../../../shared/utils/base-models/base-service';
import IntegrationMapping from './integration-mapping.model';
import integrationMappingRepository, { IntegrationMappingRepository } from './integration-mapping.repository';

export class IntegrationMappingService extends BaseService<IntegrationMapping, IntegrationMappingRepository> {
  constructor() {
    super(integrationMappingRepository);
  }
}

export default new IntegrationMappingService();
