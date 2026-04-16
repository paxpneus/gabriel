import BaseController from '../../../shared/utils/base-models/base-controller';
import IntegrationMapping from './integration-mapping.model';
import IntegrationMappingService from './integration-mapping.service';

export class IntegrationMappingController extends BaseController<IntegrationMapping, typeof IntegrationMappingService> {
  constructor() {
    super(IntegrationMappingService);
  }
}

export default new IntegrationMappingController();
