import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { ProductAttributes, ProductCreationAttributes } from "./product.types";
import { v4 as uuidv4 } from "uuid";
import Brand from "../brands/brands.model";
import Rim from "../rims/rim.model";
import TireMeasure from "../tire-measures/tire-measure.model";

class Product
  extends Model<ProductAttributes, ProductCreationAttributes>
  implements ProductAttributes
{
  public id!: string;
  public name!: string;
  public ean?: string;
  public ean_tribut?: string;
  public id_system?: string;
  public type?: string;
  public category?: string;
  public integrations_id?: string;
  public supplier_id?: string;
  public brand_id?: string;
  public source_payload?: Record<string, unknown>;
  public unit?: string;
  public brand?: string;
  public commission?: number;
  public gross_weight?: number;
  public net_weight?: number;
  public stock_virtual_total?: number;
  public line?: string;
  public measure?: string;
  public rim?: string | null;
  public measure_id?: string | null;
  public rim_id?: string | null;
  public subgroup_id?: string;
  public brandRegister?: Brand
  public rimRegister?: Rim
  public measureRegister?: TireMeasure

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Product.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    id_system: { type: DataTypes.STRING(100), allowNull: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    ean: { type: DataTypes.STRING(20), allowNull: true },
    ean_tribut: { type: DataTypes.STRING(20), allowNull: true },
    type: { type: DataTypes.ENUM("UNIT", "KIT"), defaultValue: "UNIT" },
    subgroup_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "subgroups", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    integrations_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "integrations", key: "id" },
    },
    supplier_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "suppliers", key: "id" },
    },
    brand_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "brands", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    source_payload: { type: DataTypes.JSONB, allowNull: true },
    unit: { type: DataTypes.STRING(20), allowNull: true },
    brand: { type: DataTypes.STRING(100), allowNull: true },
    commission: { type: DataTypes.FLOAT, allowNull: true },
    line: { type: DataTypes.STRING(100), allowNull: true },
    measure: { type: DataTypes.STRING(50), allowNull: true },
    rim: { type: DataTypes.STRING(5), allowNull: true },
    measure_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "tire_measures", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    rim_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "rims", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    gross_weight: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
    net_weight: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
    stock_virtual_total: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  },
  {
    sequelize,
    tableName: "products",
    timestamps: true,
    underscored: true,
  },
);

export default Product;
