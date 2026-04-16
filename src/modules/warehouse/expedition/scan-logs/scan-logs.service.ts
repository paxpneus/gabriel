import BaseService from '../../../../shared/utils/base-models/base-service';
import ExpeditionScanLog from './scan-logs.model';
import expeditionScanLogRepository, { ExpeditionScanLogRepository } from './scan-logs.repository';

export class ExpeditionScanLogService extends BaseService<ExpeditionScanLog, ExpeditionScanLogRepository> {
  constructor() {
    super(expeditionScanLogRepository);
  }
}

export default new ExpeditionScanLogService();
