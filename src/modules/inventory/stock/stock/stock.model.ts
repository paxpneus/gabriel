import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { StockAttributes, StockCreationAttributes } from './stock.types';
import { v4 as uuidv4 } from 'uuid';

class Stock extends Model<StockAttributes, StockCreationAttributes> implements StockAttributes {
  public id!: string;
  public product_id!: string;
  public quantity!: number;
  public unit_business_id!: string;
  public total_price?: number
  // Só leitura (front), vindos da Bling; nenhum fluxo usa — quem conta é `quantity`.
  public reserved_quantity?: number | null;
  public virtual_stock?: number | null;
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
       total_price: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 0
    },
  
    quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    // saldoFisicoTotal - saldoVirtualTotal da Bling; só leitura, gravado pelo stock sync e pelo webhook.
    reserved_quantity: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // saldoVirtualTotal da Bling (físico descontando a reserva); só leitura.
    virtual_stock: {
      type: DataTypes.INTEGER,
      allowNull: true,
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
        fields: ['product_id', 'unit_business_id'],
        name: 'stocks_product_unit_business_unique',
      },
    ],
  }
);

export default Stock;
