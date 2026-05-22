import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  DailySalesStatusFactAttributes,
  DailySalesStatusFactCreationAttributes,
} from "./daily-sales-status-fact.types";

class DailySalesStatusFact
  extends Model<
    DailySalesStatusFactAttributes,
    DailySalesStatusFactCreationAttributes
  >
  implements DailySalesStatusFactAttributes
{
  public id!: string;
  public fact_date!: string;
  public unit_business_id?: string | null;
  public integration_id?: string | null;
  public status_normalized!: string;
  public status_display_name?: string | null;
  public orders_count?: number;
  public total_value?: number | string;
  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DailySalesStatusFact.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    fact_date: { type: DataTypes.DATEONLY, allowNull: false },
    unit_business_id: { type: DataTypes.UUID, allowNull: true },
    integration_id: { type: DataTypes.UUID, allowNull: true },
    status_normalized: { type: DataTypes.STRING(100), allowNull: false },
    status_display_name: { type: DataTypes.STRING(100), allowNull: true },
    orders_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    total_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    last_updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "daily_sales_status_facts",
    timestamps: true,
    underscored: true,
  },
);

export default DailySalesStatusFact;