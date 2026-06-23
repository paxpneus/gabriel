import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../../config/sequelize";
import {
  DailySellerProductFactAttributes,
  DailySellerProductFactCreationAttributes,
} from "./daily-seller-product-fact.types";

class DailySellerProductFact
  extends Model<
    DailySellerProductFactAttributes,
    DailySellerProductFactCreationAttributes
  >
  implements DailySellerProductFactAttributes
{
  public id!: string;
  public fact_date!: string;
  public seller_id!: string;
  public product_id!: string;
  public product_name?: string | null;
  public product_brand?: string | null;
  public product_measure?: string | null;
  public quantity_sold?: number | string;
  public orders_count?: number;
  public total_sold?: number | string;
  public total_cost?: number | string;
  public total_commission?: number | string;
  public total_markup_value?: number | string;
  public total_contribution_value?: number | string;
  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DailySellerProductFact.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    fact_date: { type: DataTypes.DATEONLY, allowNull: false },
    seller_id: { type: DataTypes.UUID, allowNull: false },
    product_id: { type: DataTypes.UUID, allowNull: false },
    product_name: { type: DataTypes.STRING(255), allowNull: true },
    product_brand: { type: DataTypes.STRING(100), allowNull: true },
    product_measure: { type: DataTypes.STRING(50), allowNull: true },
    quantity_sold: { type: DataTypes.INTEGER, defaultValue: 0 },
    orders_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    total_sold: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_cost: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_commission: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_markup_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_contribution_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    last_updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "daily_seller_product_facts",
    timestamps: true,
    underscored: true,
  },
);

export default DailySellerProductFact;