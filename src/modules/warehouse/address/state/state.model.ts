import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import { StateAttributes, StateCreationAttributes } from "./state.types";

class State
  extends Model<StateAttributes, StateCreationAttributes>
  implements StateAttributes
{
  public id!: string;
  public acronym!: string;
  public name!: string;
  public icms_rate!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

State.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    acronym: {
      type: DataTypes.STRING(2),
      allowNull: false,
      unique: true,
      set(value: string) {
        this.setDataValue("acronym", value.toUpperCase());
      },
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    icms_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: "states",
    timestamps: true,
    underscored: true,
  },
);

export default State;
