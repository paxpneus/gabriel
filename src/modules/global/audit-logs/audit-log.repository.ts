import BaseRepository from "../../../shared/utils/base-models/base-repository";
import AuditLog from "./audit-log.model";

export class AuditLogRepository extends BaseRepository<AuditLog> {
  constructor() {
    super(AuditLog);
  }
}

export default new AuditLogRepository();
