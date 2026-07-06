import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../config/sequelize";
import {
  DailySalesProductFactAttributes,
  DailySalesProductFactCreationAttributes,
} from "./daily-sales-product-fact.types";

class DailySalesProductFact
  extends Model<
    DailySalesProductFactAttributes,
    DailySalesProductFactCreationAttributes
  >
  implements DailySalesProductFactAttributes
{
  public id!: string;
  public fact_date!: string;
  public unit_business_id?: string | null;
  public product_id?: string | null;
  public sku!: string;
  public description?: string | null;
  public quantity?: number | string;
  public total_cost?: number | string;
  public total_value?: number | string;
  public markup_pct?: number | string;
  public total_commission?: number | string;
  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DailySalesProductFact.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    fact_date: { type: DataTypes.DATEONLY, allowNull: false },
    unit_business_id: { type: DataTypes.UUID, allowNull: true },
    product_id: { type: DataTypes.UUID, allowNull: true },
    sku: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    quantity: { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    total_cost: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    markup_pct: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
    total_commission: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },
    last_updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "daily_sales_product_facts",
    timestamps: true,
    underscored: true,
  },
);

export default DailySalesProductFact;
