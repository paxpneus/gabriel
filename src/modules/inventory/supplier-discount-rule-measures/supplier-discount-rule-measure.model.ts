import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  SupplierDiscountRuleMeasureAttributes,
  SupplierDiscountRuleMeasureCreationAttributes,
} from "./supplier-discount-rule-measure.types";

class SupplierDiscountRuleMeasure
  extends Model<
    SupplierDiscountRuleMeasureAttributes,
    SupplierDiscountRuleMeasureCreationAttributes
  >
  implements SupplierDiscountRuleMeasureAttributes
{
  public id!: string;
  public supplier_discount_rule_id!: string;
  public measure_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SupplierDiscountRuleMeasure.init(
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
    measure_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "tire_measures", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
  },
  {
    sequelize,
    tableName: "supplier_discount_rule_measures",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["supplier_discount_rule_id", "measure_id"],
        name: "uq_supplier_discount_rule_measures_rule_measure",
      },
    ],
  },
);

export default SupplierDiscountRuleMeasure;
