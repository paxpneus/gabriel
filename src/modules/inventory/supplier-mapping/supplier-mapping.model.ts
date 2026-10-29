import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { SupplierMappingAttributes, SupplierMappingCreationAttributes, SYNC_SUPPLIER_CNPJ_PREFIX } from './supplier-mapping.types';
import { v4 as uuidv4 } from 'uuid';
import { cleanDocument } from '../../../shared/utils/normalizers/document';
import Product from '../products/product.model';

class SupplierMapping extends Model<SupplierMappingAttributes, SupplierMappingCreationAttributes> implements SupplierMappingAttributes {
  public id!: string;
  public product_id!: string;
  public supplier_cnpj!: string;
  public supplier_product_code!: string;
  public integrations_id?: string;
  public is_physical_override!: boolean;

  public product?: Product

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
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    supplier_product_code: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    integrations_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'integrations',
        key: 'id',
      },
    },
    // EAN físico confirmado: exclusivo desse produto na integração, o sync não grava esse EAN em outros.
    is_physical_override: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'product_supplier_maps',
    timestamps: true,
    underscored: true,
    
    hooks: {
      beforeCreate: (instance: any) => {
        if (instance.supplier_cnpj && !String(instance.supplier_cnpj).startsWith(SYNC_SUPPLIER_CNPJ_PREFIX)) {
          instance.supplier_cnpj = cleanDocument(instance.supplier_cnpj)
        }
      },

      beforeUpdate: (instance: any) => {
        if (instance.supplier_cnpj && !String(instance.supplier_cnpj).startsWith(SYNC_SUPPLIER_CNPJ_PREFIX)) {
          instance.supplier_cnpj = cleanDocument(instance.supplier_cnpj)
        }
      },
    
    }
  }
);

export default SupplierMapping;
