import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import AuditLog from "./audit-log.model";
import auditLogRepository, { AuditLogRepository } from "./audit-log.repository";
import { AuditEntity, AuditLogEntry, AuditLogAuthor } from "./audit-log.types";
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

  // Última alteração (quem/quando) de cada entidade — uma query só pra várias entidades.
  async findLatestAuthors(
    entity: AuditEntity,
    internalIds: string[],
    transaction?: Transaction,
  ): Promise<Map<string, AuditLogAuthor>> {
    const authors = new Map<string, AuditLogAuthor>();
    if (!internalIds.length) return authors;

    const logs = await this.repository.findByEntityIds(entity, internalIds, transaction);
    for (const log of logs as Array<AuditLog & { user?: { name: string } }>) {
      if (authors.has(log.internal_id)) continue;
      authors.set(log.internal_id, {
        user_id: log.user_id,
        user_name: log.user?.name ?? null,
        date: log.date,
      });
    }
    return authors;
  }
}

export default new AuditLogService();
