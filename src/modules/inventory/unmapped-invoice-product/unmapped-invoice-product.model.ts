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
  public invoice_id!: string | null;
  public ean!: string | null;
  public sku!: string | null;
  public product_name!: string | null;
  public reason!: string;
  public status!: string;
  public quantity!: number;
  public image_path!: string;
  public integrations_id!: string | null;

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
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
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
    integrations_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'integrations',
        key: 'id',
      },
    },
    status: {
      type: DataTypes.ENUM(
        "UNMAPPED",
        "MAPPED",
      ),
      defaultValue: "UNMAPPED",
      allowNull: false,
    },
    reason: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    image_path: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'unmapped_invoice_products',
    timestamps: true,
    underscored: true,
  },
);

export default UnmappedInvoiceProduct;
