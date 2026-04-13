import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import ExpeditionBatch from './batch.model';

export class ExpeditionBatchRepository extends BaseRepository<ExpeditionBatch> {
  constructor() {
    super(ExpeditionBatch);
  }
}

export default new ExpeditionBatchRepository();
