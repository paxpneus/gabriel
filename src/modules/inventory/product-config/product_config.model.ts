import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import {
  ProductConfigAttributes,
  ProductConfigCreationAttributes,
} from './product_config.types';
import { v4 as uuidv4 } from 'uuid';
import { ProductAttributes } from '../products/product.types';

class ProductConfig
  extends Model<ProductConfigAttributes, ProductConfigCreationAttributes>
  implements ProductConfigAttributes
{
  public id!: string;
  public product_id!: string;
  public unit_business_id!: string;

  public sku?: string;

  public price?: number;
  public supplier_cost_price?: number;
  public supplier_purchase_price?: number;
  public average_cost?: number;
  public average_cost_updated_at?: Date;

  public ncm?: string;
  public cest?: string;
  public gtin?: string;
  public gtin_package?: string;

  public product?: ProductAttributes
}

ProductConfig.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id',
      },
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'unit_businesses',
        key: 'id',
      },
    },
    sku: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    price: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 0,
    },
    supplier_cost_price: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },
    supplier_purchase_price: {
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

    ncm: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    cest: {
      type: DataTypes.STRING(20),
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
  },
  {
    sequelize,
    tableName: 'product_configs',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['product_id', 'unit_business_id'],
        name: 'uq_product_config_product_unit_business',
      },
    ],
  }
);

export default ProductConfig;
