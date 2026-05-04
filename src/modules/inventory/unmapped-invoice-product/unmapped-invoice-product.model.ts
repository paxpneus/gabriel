import { Model, DataTypes } from 'sequelize';
import sequelize from '../../../config/sequelize';
import { v4 as uuidv4 } from 'uuid';
import {
  UnmappedInvoiceProductAttributes,
  UnmappedInvoiceProductCreationAttributes,
} from './unmapped-invoice-product.types';

class UnmappedInvoiceProduct
  extends Model<UnmappedInvoiceProductAttributes, UnmappedInvoiceProductCreationAttributes>
  implements UnmappedInvoiceProductAttributes
{
  public id!: string;
  public invoice_id!: string;
  public ean!: string | null;
  public sku!: string | null;
  public product_name!: string | null;
  public reason!: string;
  public status!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UnmappedInvoiceProduct.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'invoices',
        key: 'id',
      },
    },
    ean: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    sku: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    product_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(
        "UNMAPPED",
        "MAPPED",
      ),
      defaultValue: "PENDING",
      allowNull: false,
    },
    reason: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'unmapped_invoice_products',
    timestamps: true,
    underscored: true,
  },
);

export default UnmappedInvoiceProduct;