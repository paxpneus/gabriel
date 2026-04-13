import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { ExpeditionScanLogAttributes, ExpeditionScanLogCreationAttributes } from './scan-logs.types';
import { v4 as uuidv4 } from 'uuid';

class ExpeditionScanLog extends Model<ExpeditionScanLogAttributes, ExpeditionScanLogCreationAttributes> implements ExpeditionScanLogAttributes {
  public id!: string;
  public expedition_batch_items_id!: string;
  public label_full_code!: string;
  public vol_number!: string;
  public user_id!: string;
  public expedition_batch_invoices_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ExpeditionScanLog.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    expedition_batch_items_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'expedition_batch_items',
        key: 'id',
      },
    },
    expedition_batch_invoices_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'expedition_batch_invoices',
        key: 'id',
      },
    },
    label_full_code: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    vol_number: {
      type: DataTypes.STRING(6),
      allowNull: false,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
    },
  },
  {
    sequelize,
    tableName: 'expedition_scan_logs',
    timestamps: true,
    underscored: true,
  }
);

export default ExpeditionScanLog;
