import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import ExpeditionScanLog from './scan-logs.model';

export class ExpeditionScanLogRepository extends BaseRepository<ExpeditionScanLog> {
  constructor() {
    super(ExpeditionScanLog);
  }
}

export default new ExpeditionScanLogRepository();
