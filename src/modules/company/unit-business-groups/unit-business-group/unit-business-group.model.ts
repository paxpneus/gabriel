import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  UnitBusinessGroupAttributes,
  UnitBusinessGroupCreationAttributes,
} from "./unit-business-group.types";
import { v4 as uuidv4 } from "uuid";

class UnitBusinessGroup
  extends Model<UnitBusinessGroupAttributes, UnitBusinessGroupCreationAttributes>
  implements UnitBusinessGroupAttributes
{
  public id!: string;
  public name!: string;
  public description?: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UnitBusinessGroup.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "unit_business_groups",
    timestamps: true,
    underscored: true,
  },
);

export default UnitBusinessGroup;
