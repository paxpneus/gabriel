import BaseController from '../../../../shared/utils/base-models/base-controller';
import ExpeditionBatchItems from './batch-items.model';
import ExpeditionBatchItemsService from './batch-items.service';

export class ExpeditionBatchItemsController extends BaseController<ExpeditionBatchItems, typeof ExpeditionBatchItemsService> {
  constructor() {
    super(ExpeditionBatchItemsService);
  }
}

export default new ExpeditionBatchItemsController();
