import { DataTypes, Model } from "sequelize";
import sequelize from "../../../config/sequelize";
import { AreaAttributes, AreaCreationAttributes } from "./areas.types";
class Area
  extends Model<AreaAttributes, AreaCreationAttributes>
  implements AreaAttributes
{
  public id!: number;
  public name!: string;
  public color!: string | null;
  public is_active!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}
Area.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    color: { type: DataTypes.STRING(7), allowNull: true },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  { sequelize, tableName: "areas", timestamps: true, underscored: true },
);
export default Area;
