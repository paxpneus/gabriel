import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { SupplierMappingAttributes, SupplierMappingCreationAttributes } from './supplier-mapping.types';
import { v4 as uuidv4 } from 'uuid';

class SupplierMapping extends Model<SupplierMappingAttributes, SupplierMappingCreationAttributes> implements SupplierMappingAttributes {
  public id!: string;
  public product_id!: string;
  public supplier_cnpj!: string;
  public supplier_product_code!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SupplierMapping.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'products',
        key: 'id',
      },
    },
    supplier_cnpj: {
      type: DataTypes.STRING(14),
      allowNull: false,
    },
    supplier_product_code: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'product_supplier_maps',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['product_id', 'supplier_cnpj'],
      },
    ],
  }
);

export default SupplierMapping;
