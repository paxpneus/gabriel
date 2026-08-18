import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../../config/sequelize";
import {
  TicketStatusAttributes,
  TicketStatusCreationAttributes,
} from "./ticket-statuses.types";
class TicketStatus
  extends Model<TicketStatusAttributes, TicketStatusCreationAttributes>
  implements TicketStatusAttributes
{
  public id!: number;
  public name!: string;
  public color!: string | null;
  public completed!: boolean;
  public canceled!: boolean;
  public display_order!: number;
  public is_active!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}
TicketStatus.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    color: { type: DataTypes.STRING(7), allowNull: true },
    completed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    canceled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    display_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "ticket_statuses",
    timestamps: true,
    underscored: true,
  },
);
export default TicketStatus;
