import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { ProductAttributes, ProductCreationAttributes } from './product.types';
import { v4 as uuidv4 } from 'uuid';

class Product extends Model<ProductAttributes, ProductCreationAttributes> implements ProductAttributes {
  public id!: string;
  public name!: string;
  public sku?: string;
  public ean?: string;
  public ean_tribut?: string;
  public id_system?: string;
  public price?: number;
  public type?: string;
  public integrations_id?: string;
  public supplier_id?: string;
  public supplier_cost_price?: number;
  public supplier_purchase_price?: number;
  public source_payload?: Record<string, unknown>;
  public unit?: string;
  public brand?: string;
  public gross_weight?: number;
  public net_weight?: number;
  public gtin?: string;
  public gtin_package?: string;
  public ncm?: string;
  public cest?: string;
  public stock_virtual_total?: number;
  public average_cost?: number;
  public average_cost_updated_at?: Date;
  public line?: string;
  public measure?: string;
  
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
    id_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    sku: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    ean: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    ean_tribut: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    price: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 0,
    },
    type: {
      type: DataTypes.ENUM("UNIT", "KIT"),
      defaultValue: "UNIT",
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
    supplier_cost_price: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },
    supplier_purchase_price: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },
    source_payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    unit: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    brand: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    line: {                          
  type: DataTypes.STRING(100),
  allowNull: true,
},
measure: {                       
  type: DataTypes.STRING(50),
  allowNull: true,
},
    gross_weight: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },
    net_weight: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },
    gtin: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    gtin_package: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    ncm: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    cest: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    stock_virtual_total: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },
    average_cost: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },
    average_cost_updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'products',
    timestamps: true,
    underscored: true,
  }
);

export default Product;