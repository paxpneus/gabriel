import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import { TicketAttributes, TicketCreationAttributes } from "./tickets.types";
class Ticket
  extends Model<TicketAttributes, TicketCreationAttributes>
  implements TicketAttributes
{
  public id!: string;
  public title!: string;
  public description!: string;
  public requester_user_id!: string;
  public area_id!: number;
  public priority_id!: number;
  public status_id!: number;
  public completed_at!: Date | null;
  public due_date!: Date | null;
  public is_late!: boolean;
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
      allowNull: false,
      references: { model: "areas", key: "id" },
    },
    priority_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "priorities", key: "id" },
    },
    status_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "ticket_statuses", key: "id" },
    },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    due_date: { type: DataTypes.DATE, allowNull: true },
    is_late: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  { sequelize, tableName: "tickets", timestamps: true, underscored: true },
);
export default Ticket;
