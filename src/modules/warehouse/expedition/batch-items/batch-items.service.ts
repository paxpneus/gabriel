import BaseService from '../../../../shared/utils/base-models/base-service';
import ExpeditionBatchItems from './batch-items.model';
import expeditionBatchItemsRepository, { ExpeditionBatchItemsRepository } from './batch-items.repository';

export class ExpeditionBatchItemsService extends BaseService<ExpeditionBatchItems, ExpeditionBatchItemsRepository> {
  constructor() {
    super(expeditionBatchItemsRepository);
  }
}

export default new ExpeditionBatchItemsService();
