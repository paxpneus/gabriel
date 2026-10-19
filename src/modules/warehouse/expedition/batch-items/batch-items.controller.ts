import BaseController from '../../../../shared/utils/base-models/base-controller';
import ExpeditionBatchItems from './batch-items.model';
import ExpeditionBatchItemsService from './batch-items.service';
import { authenticate } from '../../../../middlewares/auth-token';

export class ExpeditionBatchItemsController extends BaseController<ExpeditionBatchItems, typeof ExpeditionBatchItemsService> {
  constructor() {
    super(ExpeditionBatchItemsService);
  }

  // Sem middlewaresFor o CRUD genérico ficava aberto sem login.
  protected middlewaresFor() {
    return {
      index: [authenticate],
      show: [authenticate],
      create: [authenticate],
      bulkCreate: [authenticate],
      update: [authenticate],
      bulkUpdate: [authenticate],
      destroy: [authenticate],
      bulkDestroy: [authenticate],
    };
  }
}

export default new ExpeditionBatchItemsController();
