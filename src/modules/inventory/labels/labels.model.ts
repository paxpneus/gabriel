import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { LabelAttributes, LabelCreationAttributes } from "./labels.types";
import { v4 as uuidv4 } from "uuid";

class Label
  extends Model<LabelAttributes, LabelCreationAttributes>
  implements LabelAttributes
{
  public id!: string;
  public type!: "STOCK" | "SHIPPING";
  public name!: string;
  public layout?: Record<string, unknown> | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Label.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("STOCK", "SHIPPING"),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    layout: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
      // ex futuro: { width, height, qr_code: { x, y }, barcode: { x, y } }
    },
  },
  {
    sequelize,
    tableName: "labels",
    timestamps: true,
    underscored: true,
  },
);

export default Label;