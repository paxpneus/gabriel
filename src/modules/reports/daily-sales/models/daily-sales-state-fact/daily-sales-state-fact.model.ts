import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  DailySalesStateFactAttributes,
  DailySalesStateFactCreationAttributes,
} from "./daily-sales-state-fact.types";

class DailySalesStateFact
  extends Model<
    DailySalesStateFactAttributes,
    DailySalesStateFactCreationAttributes
  >
  implements DailySalesStateFactAttributes
{
  public id!: string;
  public fact_date!: string;
  public unit_business_id?: string | null;
  public destination_uf!: string;
  public orders_count?: number;
  public items_quantity?: number | string;
  public total_value?: number | string;
  public total_freight?: number | string;
  public average_freight?: number | string;
  public average_ticket?: number | string;
  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

const money = { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 };

DailySalesStateFact.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    fact_date: { type: DataTypes.DATEONLY, allowNull: false },
    unit_business_id: { type: DataTypes.UUID, allowNull: true },
    destination_uf: { type: DataTypes.STRING(2), allowNull: false },
    orders_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    items_quantity: { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    total_value: money,
    total_freight: money,
    average_freight: money,
    average_ticket: money,
    last_updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "daily_sales_state_facts",
    timestamps: true,
    underscored: true,
  },
);

export default DailySalesStateFact;
