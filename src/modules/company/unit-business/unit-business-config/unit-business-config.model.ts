import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  UnitBusinessConfigAttributes,
  UnitBusinessConfigCreationAttributes,
} from "./unit-business-config.types";
import { v4 as uuidv4 } from "uuid";

class UnitBusinessConfig
  extends Model<UnitBusinessConfigAttributes, UnitBusinessConfigCreationAttributes>
  implements UnitBusinessConfigAttributes
{
  public id!: string;
  public unit_business_id!: string;
  public label_stock_id?: string | null;
  public label_shipping_id?: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UnitBusinessConfig.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true, 
      references: { model: "unit_businesses", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    label_stock_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "labels", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    label_shipping_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "labels", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  },
  {
    sequelize,
    tableName: "unit_business_configs",
    timestamps: true,
    underscored: true,
  },
);

export default UnitBusinessConfig;