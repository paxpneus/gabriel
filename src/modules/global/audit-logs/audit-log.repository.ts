import { Op, Transaction } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import AuditLog from "./audit-log.model";
import User from "../../company/users/users/user.model";
import { AuditEntity } from "./audit-log.types";

export class AuditLogRepository extends BaseRepository<AuditLog> {
  constructor() {
    super(AuditLog);
  }

  // Logs das entidades informadas, mais recente primeiro, com o nome de quem fez.
  findByEntityIds(
    entity: AuditEntity,
    internalIds: string[],
    transaction?: Transaction,
  ): Promise<AuditLog[]> {
    return this.findAll({
      where: { entity, internal_id: { [Op.in]: internalIds } },
      attributes: ["internal_id", "user_id", "date"],
      include: [{ model: User, as: "user", attributes: ["id", "name"] }],
      order: [["date", "DESC"]],
      transaction,
    });
  }
}

export default new AuditLogRepository();
