import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { StockAttributes, StockCreationAttributes } from './stock.types';
import { v4 as uuidv4 } from 'uuid';

class Stock extends Model<StockAttributes, StockCreationAttributes> implements StockAttributes {
  public id?: string;
  public product_id!: string;
  public quantity!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Stock.init(
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
      unique: true,
      references: {
        model: 'products',
        key: 'id',
      },
    },
    quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'stocks',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: [ 'product_id'],
      },
    ],
  }
);

export default Stock;
