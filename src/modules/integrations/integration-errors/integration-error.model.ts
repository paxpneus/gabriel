import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { v4 as uuidv4 } from 'uuid';
import {
  IntegrationErrorAttributes,
  IntegrationErrorCreationAttributes,
  IntegrationErrorEntity,
} from './integration-error.types';

class IntegrationError
  extends Model<IntegrationErrorAttributes, IntegrationErrorCreationAttributes>
  implements IntegrationErrorAttributes
{
  public id!: string;
  public entity!: IntegrationErrorEntity;
  public type!: string;
  public integrations_id!: string;
  public external_id!: string | null;
  public internal_id!: string | null;
  public reference!: string | null;
  public message!: string | null;
  public resolved!: boolean;
  public resolved_at!: Date | null;
  public event_id!: string | null;
  public occurrences!: number;
  public last_seen_at!: Date;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

IntegrationError.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    entity: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    integrations_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'integrations',
        key: 'id',
      },
    },
    external_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    internal_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    reference: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    message: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    resolved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    event_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'events',
        key: 'id',
      },
    },
    occurrences: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    last_seen_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'integration_errors',
    timestamps: true,
    underscored: true,
  },
);

export default IntegrationError;
