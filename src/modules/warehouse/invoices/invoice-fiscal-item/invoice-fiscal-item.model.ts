import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  InvoiceFiscalItemAttributes,
  InvoiceFiscalItemCreationAttributes,
} from "./invoice-fiscal-item.types";

class InvoiceFiscalItem
  extends Model<InvoiceFiscalItemAttributes, InvoiceFiscalItemCreationAttributes>
  implements InvoiceFiscalItemAttributes
{
  public id!: string;
  public invoice_id!: string;
  public product_id?: string | null;
  public item_number?: number | null;
  public sku?: string | null;
  public description?: string | null;
  public quantity?: number | string;
  public unit_price?: number | string;
  public total_value?: number | string;
  public ncm?: string | null;
  public cest?: string | null;
  public cfop?: string | null;
  public gtin?: string | null;
  public approx_tax_value?: number | string;

  public freight_value?: number | string;
  public insurance_value?: number | string;
  public other_expenses_value?: number | string;
  public discount_value?: number | string;

  // Impostos
  public icms_rate?: number | string;
  public icms_value?: number | string;
  public icms_st_value?: number | string;
  public ipi_value?: number | string;
  public pis_value?: number | string;
  public cofins_value?: number | string;
  public difal_value?: number | string;
  public ibs_value?: number | string;
  public cbs_value?: number | string;

  public acquisition_unit_cost?: number | string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

InvoiceFiscalItem.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
    },

    invoice_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    product_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },

    item_number: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    sku: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    quantity: {
      type: DataTypes.DECIMAL(14, 4),
      defaultValue: 0,
    },

    unit_price: {
      type: DataTypes.DECIMAL(14, 4),
      defaultValue: 0,
    },

    total_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    ncm: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    cest: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    cfop: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    gtin: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },

    approx_tax_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    freight_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    insurance_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    other_expenses_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    discount_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    // Impostos
    icms_rate: {
      type: DataTypes.DECIMAL(8, 4),
      defaultValue: 0,
    },

    icms_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    icms_st_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    ipi_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    pis_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    cofins_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    difal_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    ibs_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    cbs_value: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },

    acquisition_unit_cost: {
      type: DataTypes.DECIMAL(14, 4),
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: "invoice_fiscal_items",
    timestamps: true,
    underscored: true,
  },
);

export default InvoiceFiscalItem;
