import BaseController from '../../../../shared/utils/base-models/base-controller';
import ExpeditionBatch from './batch.model';
import ExpeditionBatchService from './batch.service';

export class ExpeditionBatchController extends BaseController<ExpeditionBatch, typeof ExpeditionBatchService> {
  constructor() {
    super(ExpeditionBatchService);
  }
}

export default new ExpeditionBatchController();
