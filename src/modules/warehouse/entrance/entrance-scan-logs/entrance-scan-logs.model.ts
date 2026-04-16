import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { EntranceScanLogAttributes, EntranceScanLogCreationAttributes } from './entrance-scan-logs.types';
import { v4 as uuidv4 } from 'uuid';

class EntranceScanLog extends Model<EntranceScanLogAttributes, EntranceScanLogCreationAttributes> implements EntranceScanLogAttributes {
  public id!: string;
  public invoice_items_id!: string;
  public label_full_code!: string;
  public vol_number!: string;
  public user_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

EntranceScanLog.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    invoice_items_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'invoice_items',
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
    tableName: 'entrance_scan_logs',
    timestamps: true,
    underscored: true,
  }
);

export default EntranceScanLog;
