import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  AuditAction,
  AuditChanges,
  AuditEntity,
  AuditLogAttributes,
  AuditLogCreationAttributes,
} from "./audit-log.types";

// Registro de auditoria — só inserção, nunca atualizado (por isso sem timestamps).
class AuditLog
  extends Model<AuditLogAttributes, AuditLogCreationAttributes>
  implements AuditLogAttributes
{
  public id!: string;
  public user_id!: string | null;
  public date!: Date;
  public entity!: AuditEntity;
  public internal_id!: string;
  public action!: AuditAction;
  public description!: string;
  public changes!: AuditChanges | null;
}

AuditLog.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    entity: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    internal_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    changes: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "audit_logs",
    timestamps: false,
    underscored: true,
  },
);

export default AuditLog;
