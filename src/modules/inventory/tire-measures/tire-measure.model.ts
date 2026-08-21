import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  TireMeasureAttributes,
  TireMeasureCreationAttributes,
} from "./tire-measure.types";

class TireMeasure
  extends Model<TireMeasureAttributes, TireMeasureCreationAttributes>
  implements TireMeasureAttributes
{
  public id!: string;
  public value!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TireMeasure.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    value: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
  },
  {
    sequelize,
    tableName: "tire_measures",
    timestamps: true,
    underscored: true,
  },
);

export default TireMeasure;
