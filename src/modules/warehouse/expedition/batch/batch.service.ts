import BaseService from '../../../../shared/utils/base-models/base-service';
import ExpeditionBatch from './batch.model';
import expeditionBatchRepository, { ExpeditionBatchRepository } from './batch.repository';

export class ExpeditionBatchService extends BaseService<ExpeditionBatch, ExpeditionBatchRepository> {
  constructor() {
    super(expeditionBatchRepository);
  }
}

export default new ExpeditionBatchService();
