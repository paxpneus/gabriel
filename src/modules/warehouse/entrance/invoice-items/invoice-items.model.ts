import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { InvoiceItemsAttributes, InvoiceItemsCreationAttributes } from './invoice-items.types';
import { v4 as uuidv4 } from 'uuid';

class InvoiceItems extends Model<InvoiceItemsAttributes, InvoiceItemsCreationAttributes> implements InvoiceItemsAttributes {
  public id!: string;
  public product_id!: string;
  public invoice_id!: string;
  public quantity_expected!: number;
  public quantity_received!: number;
  public status!: 'PENDING' | 'FINISHED';

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

InvoiceItems.init(
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
    invoice_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'invoices',
        key: 'id',
      },
    },
    quantity_expected: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    quantity_received: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'FINISHED'),
      defaultValue: 'PENDING',
    },
  },
  {
    sequelize,
    tableName: 'invoice_items',
    timestamps: true,
    underscored: true,
  }
);

export default InvoiceItems;
