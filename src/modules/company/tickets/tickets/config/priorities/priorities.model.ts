import { DataTypes, Model } from "sequelize";
import sequelize from "../../../../../../config/sequelize";
import {
  PriorityAttributes,
  PriorityCreationAttributes,
} from "./priorities.types";
class Priority
  extends Model<PriorityAttributes, PriorityCreationAttributes>
  implements PriorityAttributes
{
  public id!: number;
  public name!: string;
  public color!: string | null;
  public display_order!: number;
  public sla_hours!: number | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}
Priority.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(50), allowNull: false },
    color: { type: DataTypes.STRING(7), allowNull: true },
    display_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    sla_hours: { type: DataTypes.INTEGER, allowNull: true },
  },
  { sequelize, tableName: "priorities", timestamps: true, underscored: true },
);
export default Priority;
