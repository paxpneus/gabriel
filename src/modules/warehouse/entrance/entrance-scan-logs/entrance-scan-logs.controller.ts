import BaseController from '../../../../shared/utils/base-models/base-controller';
import EntranceScanLog from './entrance-scan-logs.model';
import EntranceScanLogService from './entrance-scan-logs.service';
import { authenticate } from '../../../../middlewares/auth-token';
import { userPermissions } from '../../../../middlewares/user-permissions';

export class EntranceScanLogController extends BaseController<
  EntranceScanLog,
  typeof EntranceScanLogService
> {
  constructor() {
    super(EntranceScanLogService);
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

export default new EntranceScanLogController();
