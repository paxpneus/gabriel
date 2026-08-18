import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import {
  DueStatus,
  TicketAttributes,
  TicketCreationAttributes,
} from "./tickets.types";
class Ticket
  extends Model<TicketAttributes, TicketCreationAttributes>
  implements TicketAttributes
{
  public id!: string;
  public title!: string;
  public description!: string;
  public requester_user_id!: string;
  public area_id!: string;
  public priority_id!: string;
  public status_id!: string;
  public completed_at!: Date | null;
  public due_date!: Date | null;
  public due_status!: DueStatus;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}
Ticket.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    requester_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    area_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "areas", key: "id" },
    },
    priority_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "priorities", key: "id" },
    },
    status_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "ticket_statuses", key: "id" },
    },
    due_status: {
      type: DataTypes.ENUM(...Object.values(DueStatus)),
      allowNull: false,
      defaultValue: DueStatus.ON_TRACK,
    },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    due_date: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: "tickets", timestamps: true, underscored: true },
);
export default Ticket;
