import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { orderAttributes, orderCreationAttributes } from "./orders.types";
import { v4 as uuidv4 } from "uuid";

class Order
  extends Model<orderAttributes, orderCreationAttributes>
  implements orderAttributes
{
  public id!: string;
  public integrations_id!: string;
  public customer_id!: string;
  public seller_id!: string;
  public id_order_system?: string;
  public number_order_system!: string;
  public number_order_channel!: string;
  public actual_step!: string;
  public actual_situation!: string;
  public collection_date?: Date;
  public date?: Date;
  public total_price?: number;
  public total_cost?: number;
  public nfe_emitted?: boolean;
  public internal_status?: string;
  public store_id?: string;
  public unit_business_id?: string;
  public invoice_id?: string;
  public waiting_acceptance?: boolean;
  public source_payload?: Record<string, unknown>;
  public total_products?: number;
  public total_order?: number;
  public discount_value?: number;
  public discount_type?: string;
  public other_expenses?: number;
  public freight_charged?: number;
  public freight_cost?: number;
  public freight_by_account?: number;
  public gross_weight?: number;
  public tax_commission?: number;
  public tax_base_value?: number;
  public marketplace_fee?: number;
  public payment_fee?: number;

  // Campos fiscais/geográficos
  public destination_uf?: string;
  public destination_city?: string;
  public icms_value?: number;
  public ipi_value?: number;
  public pis_value?: number;
  public cofins_value?: number;
  public difal_value?: number;
  public ibs_value?: number;
  public cbs_value?: number;
  public approx_tax_value?: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Order.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    integrations_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "integrations", key: "id" },
    },
    customer_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "customers", key: "id" },
    },
    seller_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "contacts",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    store_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "stores", key: "id" },
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "unit_businesses", key: "id" },
    },
    invoice_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "invoices", key: "id" },
    },
    id_order_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    number_order_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    number_order_channel: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    actual_step: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "PENDING",
    },
    actual_situation: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "ACTIVE",
    },
    collection_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    total_price: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    total_cost: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    nfe_emitted: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    waiting_acceptance: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    internal_status: {
      type: DataTypes.ENUM(
        'OPEN',
        'WAITING CHANNEL VALIDATION',
        'WAITING FOR NFE EMISSION',
        'CANCELLED',
        'EMITTED',
        'UNKNOWN'
      ),
      allowNull: false,
      defaultValue: 'OPEN',
      validate: {
        isIn: {
          args: [['OPEN', 'WAITING CHANNEL VALIDATION', 'WAITING FOR NFE EMISSION', 'CANCELLED', 'EMITTED', 'UNKNOWN']],
          msg: "O status fornecido não é permitido."
        }
      }
    },
    source_payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    total_products: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    total_order: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    discount_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    discount_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    other_expenses: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    freight_charged: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    freight_cost: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    freight_by_account: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    gross_weight: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
      defaultValue: 0,
    },
    tax_commission: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    tax_base_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    marketplace_fee: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    payment_fee: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },

    // Campos fiscais/geográficos
    destination_uf: {
      type: DataTypes.STRING(2),
      allowNull: true,
    },
    destination_city: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    icms_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    ipi_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    pis_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    cofins_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    difal_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    ibs_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    cbs_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    approx_tax_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: "orders",
    timestamps: true,
    underscored: true,
  },
);

export default Order;