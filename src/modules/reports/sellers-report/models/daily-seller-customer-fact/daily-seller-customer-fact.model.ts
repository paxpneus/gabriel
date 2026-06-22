import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../../config/sequelize";
import {
  DailySellerCustomerFactAttributes,
  DailySellerCustomerFactCreationAttributes,
} from "./daily-seller-customer-fact.types";

class DailySellerCustomerFact
  extends Model<
    DailySellerCustomerFactAttributes,
    DailySellerCustomerFactCreationAttributes
  >
  implements DailySellerCustomerFactAttributes
{
  public id!: string;
  public fact_date!: string;
  public seller_id!: string;
  public customer_id!: string;
  public customer_name?: string | null;
  public orders_count?: number;
  public total_purchased?: number | string;
  public total_commission?: number | string;
  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DailySellerCustomerFact.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    fact_date: { type: DataTypes.DATEONLY, allowNull: false },
    seller_id: { type: DataTypes.UUID, allowNull: false },
    customer_id: { type: DataTypes.UUID, allowNull: false },
    customer_name: { type: DataTypes.STRING(255), allowNull: true },
    orders_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    total_purchased: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    total_commission: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    last_updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "daily_seller_customer_facts",
    timestamps: true,
    underscored: true,
  },
);

export default DailySellerCustomerFact;