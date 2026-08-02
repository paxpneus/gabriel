import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import {
  StockDirectionType,
  StockMovementAttributes,
  StockMovementCreationAttributes,
  StockMovementType,
} from './stock-movements.types';
import { v4 as uuidv4 } from 'uuid';

class StockMovement
  extends Model<StockMovementAttributes, StockMovementCreationAttributes>
  implements StockMovementAttributes
{
  public id!: string;
  public unit_business_id!: string;
  public product_id!: string;
  public invoice_id!: string | null;
  public invoice_number?: string;
  public direction?: StockDirectionType;
  public movement_type!: StockMovementType;
  public movement_date!: Date;
  public movement_quantity!: number;
  public unit_cost_invoice?: number;
  public balance_quantity!: number;
  public resulting_average_cost!: number;
  public total_stock_value!: number;
  public manual_average_cost_value?: number;
  public is_active!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StockMovement.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'unit_businesses',
        key: 'id',
      },
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id',
      },
    },
    invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'invoices',
        key: 'id',
      },
    },
    invoice_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    movement_type: {
      type: DataTypes.ENUM('PURCHASE_ENTRY', 'SALE_OUT', 'CUSTOMER_RETURN', 'MANUAL_ADJUSTMENT'),
      allowNull: false,
    },
    direction: {
      type: DataTypes.ENUM('IN', 'OUT'),
      allowNull: true,
    },
    movement_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    movement_quantity: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
    },
    unit_cost_invoice: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true,
    },
    balance_quantity: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
    },
    resulting_average_cost: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
    },
    total_stock_value: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
    },
    manual_average_cost_value: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true,
      defaultValue: null,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    }
  },
  {
    sequelize,
    tableName: 'stock_movements',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['product_id', 'movement_date'],
        name: 'stock_movements_product_date_idx',
      },
      {
        fields: ['invoice_id', 'product_id'],
        name: 'stock_movements_invoice_product_idx',
      },
    ],
  }
);

export default StockMovement;