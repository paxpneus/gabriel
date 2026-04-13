import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { ExpeditionBatchItemsAttributes, ExpeditionBatchItemsCreationAttributes } from './batch-items.types';
import { v4 as uuidv4 } from 'uuid';

class ExpeditionBatchItems extends Model<ExpeditionBatchItemsAttributes, ExpeditionBatchItemsCreationAttributes> implements ExpeditionBatchItemsAttributes {
  public id!: string;
  public expedition_batch_id!: string;
  public product_id!: string;
  public quantity!: number;
  public quantity_scanned!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ExpeditionBatchItems.init(
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
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id',
      },
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    quantity_scanned: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'expedition_batch_items',
    timestamps: true,
    underscored: true,
  }
);

export default ExpeditionBatchItems;
