import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import EntranceScanLog from './entrance-scan-logs.model';

export class EntranceScanLogRepository extends BaseRepository<EntranceScanLog> {
  constructor() {
    super(EntranceScanLog);
  }
}

export default new EntranceScanLogRepository();
