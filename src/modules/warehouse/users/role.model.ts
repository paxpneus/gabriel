import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { RoleAttributes, RoleCreationAttributes } from './user.types';
import { v4 as uuidv4 } from 'uuid';

class Role extends Model<RoleAttributes, RoleCreationAttributes> implements RoleAttributes {
  public id!: string;
  public name!: string;
  public permissions!: string[];

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Role.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    permissions: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    sequelize,
    tableName: 'roles',
    timestamps: true,
    underscored: true,
  }
);

export default Role;
