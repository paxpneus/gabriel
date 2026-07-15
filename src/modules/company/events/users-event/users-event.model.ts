import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { UserEventAttributes, UserEventCreationAttributes } from './users-event.types';
import { v4 as uuidv4 } from 'uuid';
import Event from '../event/event.model';

class UserEvent extends Model<UserEventAttributes, UserEventCreationAttributes> implements UserEventAttributes {
  public id!: string;
  public user_id!: string;
  public event_id!: string;
  public read_at!: Date | null;
  public event?: Event | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UserEvent.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
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
    event_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'events',
        key: 'id',
      },
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'user_events',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['user_id', 'event_id'],
      },
    ],
  }
);

export default UserEvent;
