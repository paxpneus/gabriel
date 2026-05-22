import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  DailySalesStoreFactAttributes,
  DailySalesStoreFactCreationAttributes,
} from "./daily-sales-store-fact.types";

class DailySalesStoreFact
  extends Model<
    DailySalesStoreFactAttributes,
    DailySalesStoreFactCreationAttributes
  >
  implements DailySalesStoreFactAttributes
{
  public id!: string;
  public fact_date!: string;
  public unit_business_id?: string | null;
  public store_id!: string;
  public orders_count?: number;
  public items_quantity?: number | string;
  public total_value?: number | string;
  public total_freight?: number | string;
  public average_ticket?: number | string;
  public total_cost?: number | string;
  public piece_average_value?: number | string;
  public markup_pct?: number | string;
  public total_taxes?: number | string;
  public total_fees?: number | string;
  public contribution_value?: number | string;
  public contribution_pct?: number | string;
  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

const money = { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 };

DailySalesStoreFact.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    fact_date: { type: DataTypes.DATEONLY, allowNull: false },
    unit_business_id: { type: DataTypes.UUID, allowNull: true },
    store_id: { type: DataTypes.UUID, allowNull: false },
    orders_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    items_quantity: { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    total_value: money,
    total_freight: money,
    average_ticket: money,
    total_cost: money,
    piece_average_value: money,
    markup_pct: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
    total_taxes: money,
    total_fees: money,
    contribution_value: money,
    contribution_pct: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
    last_updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "daily_sales_store_facts",
    timestamps: true,
    underscored: true,
  },
);

export default DailySalesStoreFact;
