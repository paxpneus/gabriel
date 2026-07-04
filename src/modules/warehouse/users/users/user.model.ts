import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import { UserAttributes, UserCreationAttributes } from './user.types';
import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid';
import { normalizeDocument } from '../../../../shared/utils/normalizers/document';
import UserConfig from '../user_config/user_config.model';
import UnitBusiness from '../../unit-business/unit-business.model';
import Role from '../roles/role.model';

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: string;
  public name!: string;
  public cpf!: string;
  public unit_business_id!: string;
  public main_unit_business_id?: string;
  public role_id!: string;
  public email!: string;
  public password!: string;
  public id_system?: number | null;
  public config?: UserConfig;
  public role?: Role;
  public availableUnitBusinesses?: UnitBusiness[]
  public unitBusiness?: UnitBusiness;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    id_system: {
  type: DataTypes.INTEGER,
  allowNull: true,
},
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    cpf: {
      type: DataTypes.STRING(14),
      allowNull: false,
      unique: true,
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'unit_businesses',
        key: 'id',
      },
    },
    main_unit_business_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'unit_businesses',
        key: 'id',
      },
    },
    role_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'roles',
        key: 'id',
      },
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    password: {
        type: DataTypes.STRING(255),
        allowNull: false,
    }
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
    underscored: true,
    hooks: {
      beforeCreate: async (user: User) => {
        if (user.password) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
      beforeUpdate: async (user: User) => {
        if (user.changed('password')) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
    },
  }
);

User.beforeCreate((user) => normalizeDocument(user))
User.beforeUpdate((user) => normalizeDocument(user))

export default User;
