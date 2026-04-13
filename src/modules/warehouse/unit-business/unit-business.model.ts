import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { UnitBusinessAttributes, UnitBusinessCreationAttributes } from './unit-business.types';
import { v4 as uuidv4 } from 'uuid';

class UnitBusiness extends Model<UnitBusinessAttributes, UnitBusinessCreationAttributes> implements UnitBusinessAttributes {
  public id!: string;
  public number!: string;
  public name!: string;
  public cnpj!: string;
  public integrations_id?: string;
  public head_office!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UnitBusiness.init(
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
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    cnpj: {
      type: DataTypes.STRING(14),
      allowNull: false,
      unique: true,
    },
    integrations_id: {
      type: DataTypes.STRING(100),
    },
    head_office: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'unit_businesses',
    timestamps: true,
    underscored: true,
  }
);

export default UnitBusiness;
