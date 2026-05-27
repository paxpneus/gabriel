// unit-business-tax-config.model.ts

import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  UnitBusinessTaxConfigAttributes,
  UnitBusinessTaxConfigCreationAttributes,
} from "./unit-business-tax-config.types";
import { v4 as uuidv4 } from "uuid";

class UnitBusinessTaxConfig
  extends Model<UnitBusinessTaxConfigAttributes, UnitBusinessTaxConfigCreationAttributes>
  implements UnitBusinessTaxConfigAttributes
{
  public id!: string;
  public unit_business_id!: string;
  public approx_tax_rate!: number;
  public description?: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UnitBusinessTaxConfig.init(
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
      references: {
        model: "unit_businesses",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    approx_tax_rate: {
      type: DataTypes.DECIMAL(5, 4),
      allowNull: false,
      defaultValue: 0,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "unit_business_tax_configs",
    timestamps: true,
    underscored: true,
  },
);

export default UnitBusinessTaxConfig;