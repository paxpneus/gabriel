import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  SupplierDiscountRuleAttributes,
  SupplierDiscountRuleCreationAttributes,
} from "./supplier-discount-rule.types";

class SupplierDiscountRule
  extends Model<
    SupplierDiscountRuleAttributes,
    SupplierDiscountRuleCreationAttributes
  >
  implements SupplierDiscountRuleAttributes
{
  public id!: string;
  public quantity_step!: number;
  public discount_type!: "REAL" | "PERCENTUAL";
  public discount_value!: number;
  public start_date!: Date;
  public end_date!: Date;
  public active!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SupplierDiscountRule.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    quantity_step: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    discount_type: {
      type: DataTypes.ENUM("REAL", "PERCENTUAL"),
      allowNull: false,
    },
    discount_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    start_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    end_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "supplier_discount_rules",
    timestamps: true,
    underscored: true,
  },
);

export default SupplierDiscountRule;
