import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import { SubtaskAttributes, SubtaskCreationAttributes } from "./subtasks.types";
class Subtask
  extends Model<SubtaskAttributes, SubtaskCreationAttributes>
  implements SubtaskAttributes
{
  public id!: string;
  public ticket_id!: string;
  public description!: string;
  public is_completed!: boolean;
  public completed_at!: Date | null;
  public display_order!: number;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}
Subtask.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    ticket_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "tickets", key: "id" },
    },
    description: { type: DataTypes.STRING(255), allowNull: false },
    is_completed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    display_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  { sequelize, tableName: "subtasks", timestamps: true, underscored: true },
);
export default Subtask;
