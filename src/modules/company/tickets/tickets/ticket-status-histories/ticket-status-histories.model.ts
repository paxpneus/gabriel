import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import {
  TicketStatusHistoryAttributes,
  TicketStatusHistoryCreationAttributes,
} from "./ticket-status-histories.types";
class TicketStatusHistory
  extends Model<
    TicketStatusHistoryAttributes,
    TicketStatusHistoryCreationAttributes
  >
  implements TicketStatusHistoryAttributes
{
  public id!: string;
  public ticket_id!: string;
  public status_id!: string;
  public changed_by_user_id!: string | null;
  public changed_at!: Date;
}
TicketStatusHistory.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    ticket_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "tickets", key: "id" },
    },
    status_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "ticket_statuses", key: "id" },
    },
    changed_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    changed_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "ticket_status_histories",
    timestamps: false,
    underscored: true,
  },
);
export default TicketStatusHistory;
