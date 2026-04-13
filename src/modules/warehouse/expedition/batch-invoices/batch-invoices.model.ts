import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { ExpeditionBatchInvoiceAttributes, ExpeditionBatchInvoiceCreationAttributes } from './batch-invoices.types';
import { v4 as uuidv4 } from 'uuid';

class ExpeditionBatchInvoice extends Model<ExpeditionBatchInvoiceAttributes, ExpeditionBatchInvoiceCreationAttributes> implements ExpeditionBatchInvoiceAttributes {
  public id!: string;
  public expedition_batch_id!: string;
  public invoice_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ExpeditionBatchInvoice.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    expedition_batch_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'expedition_batches',
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
  },
  {
    sequelize,
    tableName: 'expedition_batch_invoices',
    timestamps: true,
    underscored: true,
  }
);

export default ExpeditionBatchInvoice;
