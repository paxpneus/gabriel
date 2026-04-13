import BaseRepository from '../../../shared/utils/base-models/base-repository';
import IntegrationMapping from './integration-mapping.model';

export class IntegrationMappingRepository extends BaseRepository<IntegrationMapping> {
  constructor() {
    super(IntegrationMapping);
  }
}

export default new IntegrationMappingRepository();
