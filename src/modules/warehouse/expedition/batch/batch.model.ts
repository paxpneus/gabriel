import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { ExpeditionBatchAttributes, ExpeditionBatchCreationAttributes } from './batch.types';
import { v4 as uuidv4 } from 'uuid';

class ExpeditionBatch extends Model<ExpeditionBatchAttributes, ExpeditionBatchCreationAttributes> implements ExpeditionBatchAttributes {
  public id!: string;
  public number!: string;
  public status!: 'OPEN' | 'PENDING' | 'FINISHED';
  public integrations_id?: string;
  public id_system?: string;
  public unit_business_id!: string;
  public total_volumes!: number;

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
    number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM('OPEN', 'PENDING', 'FINISHED'),
      defaultValue: 'OPEN',
    },
    integrations_id: {
      type: DataTypes.STRING(100),
    },
    id_system: {
      type: DataTypes.STRING(100),
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
  },
  {
    sequelize,
    tableName: 'expedition_batches',
    timestamps: true,
    underscored: true,
  }
);

export default ExpeditionBatch;
