import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { TransporterAttributes, TransporterCreationAttributes } from './transporter.types';
import { v4 as uuidv4 } from 'uuid';

class Transporter extends Model<TransporterAttributes, TransporterCreationAttributes> implements TransporterAttributes {
  public id!: string;
  public name!: string;
  public cnpj!: string;
  public city!: string;
  public uf!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Transporter.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
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
    city: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    uf: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'transporters',
    timestamps: true,
    underscored: true,
  }
);

export default Transporter;
