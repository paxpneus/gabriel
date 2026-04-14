import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { SupplierAttributes, SupplierCreationAttributes } from './supplier.types';
import { v4 as uuidv4 } from 'uuid';

class Supplier extends Model<SupplierAttributes, SupplierCreationAttributes> implements SupplierAttributes {
  public id!: string;
  public id_system!: string;
  public code!: string;
  public name!: string;
  public document!: string;
  public fantasy_name!: string | null;
  public city!: string;
  public uf!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Supplier.init(
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
    document: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    fantasy_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    uf: {
      type: DataTypes.STRING(2),
      allowNull: false,
    },
    id_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    code: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'suppliers',
    timestamps: true,
    underscored: true,
  }
);

export default Supplier;
