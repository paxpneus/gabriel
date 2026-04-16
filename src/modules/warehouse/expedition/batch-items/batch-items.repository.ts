import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import ExpeditionBatchItems from './batch-items.model';

export class ExpeditionBatchItemsRepository extends BaseRepository<ExpeditionBatchItems> {
  constructor() {
    super(ExpeditionBatchItems);
  }
}

export default new ExpeditionBatchItemsRepository();
