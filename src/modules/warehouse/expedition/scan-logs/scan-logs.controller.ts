import BaseController from '../../../../shared/utils/base-models/base-controller';
import ExpeditionScanLog from './scan-logs.model';
import ExpeditionScanLogService from './scan-logs.service';

export class ExpeditionScanLogController extends BaseController<ExpeditionScanLog, typeof ExpeditionScanLogService> {
  constructor() {
    super(ExpeditionScanLogService);
  }
}

export default new ExpeditionScanLogController();
