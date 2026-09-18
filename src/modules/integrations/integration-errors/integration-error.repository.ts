import BaseRepository from '../../../shared/utils/base-models/base-repository';
import IntegrationError from './integration-error.model';

export class IntegrationErrorRepository extends BaseRepository<IntegrationError> {
  constructor() {
    super(IntegrationError);
  }
}

export default new IntegrationErrorRepository();
