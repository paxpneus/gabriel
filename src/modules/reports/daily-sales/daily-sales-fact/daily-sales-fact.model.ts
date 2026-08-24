import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  DailySalesFactAttributes,
  DailySalesFactCreationAttributes,
} from "./daily-sales-fact.types";

class DailySalesFact
  extends Model<DailySalesFactAttributes, DailySalesFactCreationAttributes>
  implements DailySalesFactAttributes
{
  public id!: string;
  public fact_date!: string;
  public unit_business_id?: string | null;
  public integration_id?: string | null;

  public orders_count?: number;
  public items_quantity?: number | string;
  public total_value?: number | string;
  public total_freight?: number | string;
  public average_freight?: number | string;
  public average_ticket?: number | string;
  public total_commission?: number | string;

  public total_cost?: number | string;
  public total_taxes?: number | string;
  public total_fees?: number | string;
  public contribution_value?: number | string;
  public contribution_pct?: number | string;
  public markup_pct?: number | string;
  public total_supplier_discount?: number | string;

  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DailySalesFact.init(
  {
    id:               { type: DataTypes.UUID,    defaultValue: uuidv4, primaryKey: true },
    fact_date:        { type: DataTypes.DATEONLY, allowNull: false },
    unit_business_id: { type: DataTypes.UUID,    allowNull: true },
    integration_id:   { type: DataTypes.UUID,    allowNull: true },

    orders_count:   { type: DataTypes.INTEGER,        defaultValue: 0 },
    items_quantity: { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    total_value:    { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_freight:  { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    average_freight: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    average_ticket:  { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },

    total_cost:         { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_taxes:        { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_fees:         { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    contribution_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    contribution_pct:   { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
    markup_pct:         { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
    total_supplier_discount: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },
    total_commission: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },

    last_updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "daily_sales_facts",
    timestamps: true,
    underscored: true,
  },
);

export default DailySalesFact;