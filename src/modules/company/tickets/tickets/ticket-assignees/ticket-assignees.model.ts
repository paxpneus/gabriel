import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import { TicketAssigneeAttributes, TicketAssigneeCreationAttributes } from "./ticket-assignees.types";
class TicketAssignee extends Model<TicketAssigneeAttributes, TicketAssigneeCreationAttributes> implements TicketAssigneeAttributes { public ticket_id!: string; public user_id!: string; public assigned_at!: Date; }
TicketAssignee.init({ ticket_id: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, references: { model: "tickets", key: "id" } }, user_id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, references: { model: "users", key: "id" } }, assigned_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW } }, { sequelize, tableName: "ticket_assignees", timestamps: false, underscored: true });
export default TicketAssignee;
