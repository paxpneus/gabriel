import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  SalesOrderItemSnapshotAttributes,
  SalesOrderItemSnapshotCreationAttributes,
} from "./sales-order-item-snapshot.types";

class SalesOrderItemSnapshot
  extends Model<
    SalesOrderItemSnapshotAttributes,
    SalesOrderItemSnapshotCreationAttributes
  >
  implements SalesOrderItemSnapshotAttributes
{
  public id!: string;
  public order_snapshot_id!: string;
  public order_id!: string;
  public order_item_id?: string | null;
  public product_id?: string | null;
  public store_id?: string | null;
  public unit_business_id?: string | null;
  public integration_id?: string | null;

  public order_date!: string;
  public destination_uf?: string | null;

  public sku!: string;
  public description?: string | null;
  public unit?: string | null;

  public quantity?: number | string;
  public unit_price?: number | string;
  public gross_total?: number | string;
  public discount_value?: number | string;
  public net_total?: number | string;

  public average_cost_snapshot?: number | string;
  public total_cost_snapshot?: number | string;
  public cost_source?: string | null;

  public markup_pct?: number | string;

  public commission_base?: number | string;
  public commission_rate?: number | string;
  public commission_value?: number | string;

  public ncm?: string | null;
  public cest?: string | null;
  public cfop?: string | null;
  public gtin?: string | null;

  public approx_tax_value?: number | string;
  public icms_rate?: number | string;
  public icms_value?: number | string;
  public ipi_value?: number | string;
  public pis_value?: number | string;
  public cofins_value?: number | string;
  public difal_value?: number | string;
  public ibs_value?: number | string;
  public cbs_value?: number | string;

  public source_payload?: Record<string, unknown> | null;
  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

const money = { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 };
const qty   = { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 };

SalesOrderItemSnapshot.init(
  {
    id:                { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    order_snapshot_id: { type: DataTypes.UUID, allowNull: false },
    order_id:          { type: DataTypes.UUID, allowNull: false },
    order_item_id:     { type: DataTypes.UUID, allowNull: true, unique: true },
    product_id:        { type: DataTypes.UUID, allowNull: true },
    store_id:          { type: DataTypes.UUID, allowNull: true },
    unit_business_id:  { type: DataTypes.UUID, allowNull: true },
    integration_id:    { type: DataTypes.UUID, allowNull: true },

    order_date:      { type: DataTypes.DATEONLY,    allowNull: false },
    destination_uf:  { type: DataTypes.STRING(2),   allowNull: true },

    sku:         { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    unit:        { type: DataTypes.STRING(20),  allowNull: true },

    quantity:       qty,
    unit_price:     { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    gross_total:    money,
    discount_value: money,
    net_total:      money,

    average_cost_snapshot: { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    total_cost_snapshot:   money,
    cost_source:           { type: DataTypes.STRING(30), allowNull: true },

    markup_pct: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },

    commission_base:  money,
    commission_rate:  { type: DataTypes.DECIMAL(8, 4), defaultValue: 0 },
    commission_value: money,

    ncm:  { type: DataTypes.STRING(20), allowNull: true },
    cest: { type: DataTypes.STRING(20), allowNull: true },
    cfop: { type: DataTypes.STRING(20), allowNull: true },
    gtin: { type: DataTypes.STRING(20), allowNull: true },

    approx_tax_value: money,
    icms_rate:        { type: DataTypes.DECIMAL(8, 4), defaultValue: 0 },
    icms_value:       money,
    ipi_value:        money,
    pis_value:        money,
    cofins_value:     money,
    difal_value:      money,
    ibs_value:        money,
    cbs_value:        money,

    source_payload:  { type: DataTypes.JSONB, allowNull: true },
    last_updated_at: { type: DataTypes.DATE,  defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "sales_order_item_snapshots",
    timestamps: true,
    underscored: true,
  },
);

export default SalesOrderItemSnapshot;