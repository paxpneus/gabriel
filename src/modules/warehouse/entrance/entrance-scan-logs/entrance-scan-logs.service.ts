import BaseService from '../../../../shared/utils/base-models/base-service';
import EntranceScanLog from './entrance-scan-logs.model';
import entranceScanLogRepository, { EntranceScanLogRepository } from './entrance-scan-logs.repository';

export class EntranceScanLogService extends BaseService<EntranceScanLog, EntranceScanLogRepository> {
  constructor() {
    super(entranceScanLogRepository);
  }
}

export default new EntranceScanLogService();
