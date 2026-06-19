import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../../config/sequelize";
import {
  SalesOrderSnapshotAttributes,
  SalesOrderSnapshotCreationAttributes,
} from "./sales-order-snapshot.types";

class SalesOrderSnapshot
  extends Model<
    SalesOrderSnapshotAttributes,
    SalesOrderSnapshotCreationAttributes
  >
  implements SalesOrderSnapshotAttributes
{
  public id!: string;
  public order_id!: string;
  public invoice_id?: string | null;
  public integration_id?: string | null;
  public customer_id?: string | null;
  public store_id?: string | null;
  public unit_business_id?: string | null;

  public order_number_system?: string | null;
  public order_number_channel?: string | null;
  public invoice_number?: string | null;
  public invoice_key?: string | null;

  public order_date!: string;
  public invoice_date?: string | null;
  public emitted_at?: Date | null;

  public destination_uf?: string | null;
  public destination_city?: string | null;

  public status_snapshot?: string | null;
  public snapshot_status?: string;

  public items_quantity?: number | string;
  public total_products?: number | string;
  public total_order?: number | string;
  public discount_value?: number | string;
  public other_expenses?: number | string;

  public freight_charged?: number | string;
  public freight_cost?: number | string;
  public freight_paid_by_company?: boolean;
  public freight_by_account?: number | null;

  public total_cost?: number | string;
  public total_taxes?: number | string;
  public total_fees?: number | string;

  public tax_commission?: number | string;
  public marketplace_fee?: number | string;
  public payment_fee?: number | string;

  public icms_value?: number | string;
  public ipi_value?: number | string;
  public pis_value?: number | string;
  public cofins_value?: number | string;
  public difal_value?: number | string;
  public ibs_value?: number | string;
  public cbs_value?: number | string;
  public approx_tax_value?: number | string;

  public contribution_value?: number | string;
  public contribution_pct?: number | string;
  public markup_pct?: number | string;

  public has_cost_fallback?: boolean;
  public has_invoice_data?: boolean;
  public source_payload?: Record<string, unknown> | null;
  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SalesOrderSnapshot.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    order_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    invoice_id: { type: DataTypes.UUID, allowNull: true },
    integration_id: { type: DataTypes.UUID, allowNull: true },
    customer_id: { type: DataTypes.UUID, allowNull: true },
    store_id: { type: DataTypes.UUID, allowNull: true },
    unit_business_id: { type: DataTypes.UUID, allowNull: true },

    order_number_system: { type: DataTypes.STRING(100), allowNull: true },
    order_number_channel: { type: DataTypes.STRING(100), allowNull: true },
    invoice_number: { type: DataTypes.STRING(100), allowNull: true },
    invoice_key: { type: DataTypes.STRING(255), allowNull: true },

    order_date: { type: DataTypes.DATEONLY, allowNull: false },
    invoice_date: { type: DataTypes.DATEONLY, allowNull: true },
    emitted_at: { type: DataTypes.DATE, allowNull: true },

    destination_uf: { type: DataTypes.STRING(2), allowNull: true },
    destination_city: { type: DataTypes.STRING(100), allowNull: true },

    // valor normalizado via integration_order_status_mappings
    status_snapshot: { type: DataTypes.STRING(100), allowNull: true },
    // controle interno do processamento do job (open / closed / error)
    snapshot_status: { type: DataTypes.STRING(30), defaultValue: "open" },

    items_quantity: { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    total_products: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_order: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    discount_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    other_expenses: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },

    freight_charged: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    freight_cost: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    freight_paid_by_company: { type: DataTypes.BOOLEAN, defaultValue: false },
    freight_by_account: { type: DataTypes.INTEGER, allowNull: true },

    total_cost: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_taxes: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_fees: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },

    tax_commission: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    marketplace_fee: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    payment_fee: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },

    icms_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    ipi_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    pis_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    cofins_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    difal_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    ibs_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    cbs_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    approx_tax_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },

    contribution_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    contribution_pct: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
    markup_pct: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },

    has_cost_fallback: { type: DataTypes.BOOLEAN, defaultValue: false },
    has_invoice_data: { type: DataTypes.BOOLEAN, defaultValue: false },
    source_payload: { type: DataTypes.JSONB, allowNull: true },
    last_updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "sales_order_snapshots",
    timestamps: true,
    underscored: true,
  },
);

export default SalesOrderSnapshot;