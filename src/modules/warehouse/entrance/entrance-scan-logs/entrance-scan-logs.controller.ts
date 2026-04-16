import BaseController from '../../../../shared/utils/base-models/base-controller';
import EntranceScanLog from './entrance-scan-logs.model';
import EntranceScanLogService from './entrance-scan-logs.service';

export class EntranceScanLogController extends BaseController<EntranceScanLog, typeof EntranceScanLogService> {
  constructor() {
    super(EntranceScanLogService);
  }
}

export default new EntranceScanLogController();
