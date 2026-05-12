import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { ExpeditionBatchAttributes, ExpeditionBatchCreationAttributes } from './batch.types';
import { v4 as uuidv4 } from 'uuid';
import ExpeditionBatchInvoice from '../batch-invoices/batch-invoices.model';
import ExpeditionBatchItems from '../batch-items/batch-items.model';
import ExpeditionScanLog from '../scan-logs/scan-logs.model';

class ExpeditionBatch extends Model<ExpeditionBatchAttributes, ExpeditionBatchCreationAttributes> implements ExpeditionBatchAttributes {
  public id!: string;
  public number!: string;
  public justification!: string;
  public status!: 'OPEN' | 'PENDING' | 'FINISHED';
  public integrations_id?: string;
  public id_system?: string;
  public unit_business_id!: string;
  public total_volumes!: number;
  public total_volumes_received!: number
  public type!: string
  public transporters_id!: string | null; 
  public description?: string
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ExpeditionBatch.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    justification: {
       type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('OPEN', 'PENDING', 'FINISHED'),
      defaultValue: 'OPEN',
    },
    integrations_id: {
      type: DataTypes.UUID,
      references: {
                model: 'integrations',
                key: 'id'
            }
    },
    id_system: {
      type: DataTypes.STRING(100),
    },
    transporters_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'transporters',
        key: 'id'
      }
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'unit_businesses',
        key: 'id',
      },
    },
    total_volumes: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    total_volumes_received: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    type: {
      type: DataTypes.ENUM("INCOMING", "OUTGOING"),
      allowNull: false,
      defaultValue: 'OUTGOING'
    }
  },
  {
    sequelize,
    tableName: 'expedition_batches',
    timestamps: true,
    underscored: true,
  }
);

export default ExpeditionBatch;
