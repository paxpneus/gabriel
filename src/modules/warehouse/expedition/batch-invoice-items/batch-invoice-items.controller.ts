import BaseController from '../../../../shared/utils/base-models/base-controller';
import BatchInvoiceItems from './batch-invoice-items.model';
import BatchInvoiceItemsService from './batch-invoice-items.service';
import { authenticate } from '../../../../middlewares/auth-token';
import { userPermissions } from '../../../../middlewares/user-permissions';

export class BatchInvoiceItemsController extends BaseController<
  BatchInvoiceItems,
  typeof BatchInvoiceItemsService
> {
  constructor() {
    super(BatchInvoiceItemsService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
    };
  }
}

export default new BatchInvoiceItemsController();
