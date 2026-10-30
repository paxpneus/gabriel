import { Transaction } from "sequelize";
import { PaginatedResult, QueryParams } from "../../../shared/query/query.types";
import BaseService from "../../../shared/utils/base-models/base-service";
import AuditLog from "./audit-log.model";
import auditLogRepository, { AuditLogRepository } from "./audit-log.repository";
import { AuditAction, AuditEntity, AuditLogEntry, AuditLogAuthor, AuditOrigin } from "./audit-log.types";
import { buildAuditDescription } from "./helpers/description";

export class AuditLogService extends BaseService<AuditLog, AuditLogRepository> {
  constructor() {
    super(auditLogRepository);

    // Sem createdAt (tabela só de inserção): ordena por date; filtro por ação (CREATE/UPDATE/DELETE).
    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "date", sortDir: "DESC" },
      sortableFields: ["date"],
      filterableFields: ["action"],
    };
  }

  // Histórico de auditoria de qualquer entidade, paginado — a service da entidade chama e expõe na própria rota.
  // perPage limitado a 100 (changes é JSONB grande) e filtro de ação só com valores válidos.
  paginateByEntity(
    entity: AuditEntity,
    internalId: string,
    params: QueryParams,
  ): Promise<PaginatedResult<AuditLog>> {
    const action = params.filters?.action;
    const actions = Array.isArray(action) ? action : [action];
    if (action !== undefined && actions.some((value) => !Object.values(AuditAction).includes(value as AuditAction))) {
      throw new Error("Filtro de ação inválido: use CREATE, UPDATE ou DELETE");
    }
    const perPage = Math.min(Math.max(Number(params.perPage) || 20, 1), 100);
    return this.repository.paginateByEntity({ ...params, perPage }, this.queryConfig, entity, internalId);
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
        origin: entry.origin ?? AuditOrigin.USER,
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
