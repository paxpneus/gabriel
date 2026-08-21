import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  SupplierDiscountUnitBusinessAttributes,
  SupplierDiscountUnitBusinessCreationAttributes,
} from "./supplier-discount-unit-business.types";

class SupplierDiscountUnitBusiness
  extends Model<
    SupplierDiscountUnitBusinessAttributes,
    SupplierDiscountUnitBusinessCreationAttributes
  >
  implements SupplierDiscountUnitBusinessAttributes
{
  public id!: string;
  public supplier_discount_rule_id!: string;
  public unit_business_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SupplierDiscountUnitBusiness.init(
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
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "unit_businesses", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
  },
  {
    sequelize,
    tableName: "supplier_discount_unit_businesses",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["supplier_discount_rule_id", "unit_business_id"],
        name: "uq_supplier_discount_unit_businesses_rule_unit_business",
      },
    ],
  },
);

export default SupplierDiscountUnitBusiness;
