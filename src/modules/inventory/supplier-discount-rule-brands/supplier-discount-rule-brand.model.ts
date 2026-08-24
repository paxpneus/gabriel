import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  SupplierDiscountRuleBrandAttributes,
  SupplierDiscountRuleBrandCreationAttributes,
} from "./supplier-discount-rule-brand.types";

class SupplierDiscountRuleBrand
  extends Model<
    SupplierDiscountRuleBrandAttributes,
    SupplierDiscountRuleBrandCreationAttributes
  >
  implements SupplierDiscountRuleBrandAttributes
{
  public id!: string;
  public supplier_discount_rule_id!: string;
  public brand_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SupplierDiscountRuleBrand.init(
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
    brand_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "brands", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
  },
  {
    sequelize,
    tableName: "supplier_discount_rule_brands",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["supplier_discount_rule_id", "brand_id"],
        name: "uq_supplier_discount_rule_brands_rule_brand",
      },
    ],
  },
);

export default SupplierDiscountRuleBrand;
