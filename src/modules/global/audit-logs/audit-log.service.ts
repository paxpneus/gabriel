import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import AuditLog from "./audit-log.model";
import auditLogRepository, { AuditLogRepository } from "./audit-log.repository";
import { AuditLogEntry } from "./audit-log.types";
import { buildAuditDescription } from "./helpers/description";

export class AuditLogService extends BaseService<AuditLog, AuditLogRepository> {
  constructor() {
    super(auditLogRepository);
  }

  // Grava várias entradas num bulkCreate só, na transação do chamador — description gerada pelo helper.
  async record(entries: AuditLogEntry[], transaction?: Transaction): Promise<void> {
    if (!entries.length) return;

    await this.repository.bulkCreate(
      entries.map((entry) => ({
        user_id: entry.userId ?? null,
        entity: entry.entity,
        internal_id: entry.internalId,
        action: entry.action,
        description: buildAuditDescription(entry.entity, entry.action, entry.changes),
        changes: entry.changes,
      })),
      { transaction },
    );
  }
}

export default new AuditLogService();
