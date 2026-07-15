import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { EventAttributes, EventCreationAttributes } from './event.types';
import { v4 as uuidv4 } from 'uuid';

class Event extends Model<EventAttributes, EventCreationAttributes> implements EventAttributes {
  public id!: string;
  public title!: string;
  public description!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Event.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'events',
    timestamps: true,
    underscored: true,
  }
);

export default Event;
