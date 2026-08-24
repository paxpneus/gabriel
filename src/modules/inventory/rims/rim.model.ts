import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import { RimAttributes, RimCreationAttributes } from "./rim.types";

class Rim
  extends Model<RimAttributes, RimCreationAttributes>
  implements RimAttributes
{
  public id!: string;
  public value!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Rim.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    value: {
      type: DataTypes.STRING(5),
      allowNull: false,
      unique: true,
    },
  },
  {
    sequelize,
    tableName: "rims",
    timestamps: true,
    underscored: true,
  },
);

export default Rim;
