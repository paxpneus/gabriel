import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  SupplierDiscountRuleRimAttributes,
  SupplierDiscountRuleRimCreationAttributes,
} from "./supplier-discount-rule-rim.types";

class SupplierDiscountRuleRim
  extends Model<
    SupplierDiscountRuleRimAttributes,
    SupplierDiscountRuleRimCreationAttributes
  >
  implements SupplierDiscountRuleRimAttributes
{
  public id!: string;
  public supplier_discount_rule_id!: string;
  public rim_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SupplierDiscountRuleRim.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    supplier_discount_rule_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "supplier_discount_rules", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    rim_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "rims", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
  },
  {
    sequelize,
    tableName: "supplier_discount_rule_rims",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["supplier_discount_rule_id", "rim_id"],
        name: "uq_supplier_discount_rule_rims_rule_rim",
      },
    ],
  },
);

export default SupplierDiscountRuleRim;
