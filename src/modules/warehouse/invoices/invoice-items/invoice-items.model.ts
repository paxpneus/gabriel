import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { InvoiceItemsAttributes, InvoiceItemsCreationAttributes } from './invoice-items.types';
import { v4 as uuidv4 } from 'uuid';
import { Product } from '../../../inventory';

class InvoiceItems extends Model<InvoiceItemsAttributes, InvoiceItemsCreationAttributes> implements InvoiceItemsAttributes {
  public id!: string;
  public product_id!: string;
  public invoice_id!: string;
  public quantity_expected!: number;
  public product?: Product;

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
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'invoice_items',
    timestamps: true,
    underscored: true,
    hooks: {

      beforeUpdate: (instance: any) => {
        if (instance.quantity_received == instance.quantity_expected) {
          instance.status = 'FINISHED'
        }
      },
    
    }
  }
);

export default InvoiceItems;
