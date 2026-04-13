import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { ProductAttributes, ProductCreationAttributes } from './product.types';
import { v4 as uuidv4 } from 'uuid';

class Product extends Model<ProductAttributes, ProductCreationAttributes> implements ProductAttributes {
  public id!: string;
  public name!: string;
  public sku!: string;
  public ean!: string;

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
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    sku: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    ean: {
      type: DataTypes.STRING(13),
      allowNull: false,
      unique: true,
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
