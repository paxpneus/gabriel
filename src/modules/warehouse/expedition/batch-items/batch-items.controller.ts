import BaseController from '../../../../shared/utils/base-models/base-controller';
import ExpeditionBatchItems from './batch-items.model';
import ExpeditionBatchItemsService from './batch-items.service';
import { authenticate } from '../../../../middlewares/auth-token';
import { userPermissions } from "../../../../middlewares/user-permissions";

export class ExpeditionBatchItemsController extends BaseController<ExpeditionBatchItems, typeof ExpeditionBatchItemsService> {
  constructor() {
    super(ExpeditionBatchItemsService);
  }

  // Sem middlewaresFor o CRUD genérico ficava aberto sem login.
  protected middlewaresFor() {
    return {
      index: [authenticate],
      show: [authenticate],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }
}

export default new ExpeditionBatchItemsController();
