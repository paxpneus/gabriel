import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { BatchInvoiceItemsAttributes, BatchInvoiceItemsCreationAttributes } from './batch-invoice-items.types';
import { v4 as uuidv4 } from 'uuid';

class BatchInvoiceItems
  extends Model<BatchInvoiceItemsAttributes, BatchInvoiceItemsCreationAttributes>
  implements BatchInvoiceItemsAttributes
{
  public id!: string;
  public batch_item_id!: string;
  public batch_invoice_id!: string;
  public quantity_expected!: number;
  public quantity_read!: number;
  public status!: 'PENDING' | 'FINISHED';

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

BatchInvoiceItems.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    expedition_batch_item_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'expedition_batch_items',
        key: 'id',
      },
    },
    expedition_batch_invoice_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'expedition_batch_invoices',
        key: 'id',
      },
    },
    quantity_expected: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    quantity_read: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'FINISHED'),
      defaultValue: 'PENDING',
    },
  },
  {
    sequelize,
    tableName: 'batch_invoice_items',
    timestamps: true,
    underscored: true,
    hooks: {
      beforeUpdate: (instance: any) => {
        if (instance.quantity_received === instance.quantity_expected) {
          instance.status = 'FINISHED';
        }
      },
    },
  }
);

export default BatchInvoiceItems;