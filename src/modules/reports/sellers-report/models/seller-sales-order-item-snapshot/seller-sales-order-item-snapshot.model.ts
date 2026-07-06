import { DataTypes, Model } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../../../../config/sequelize";
import {
  SellerSalesOrderItemSnapshotAttributes,
  SellerSalesOrderItemSnapshotCreationAttributes,
} from "./seller-sales-order-item-snapshot.types";

class SellerSalesOrderItemSnapshot
  extends Model<
    SellerSalesOrderItemSnapshotAttributes,
    SellerSalesOrderItemSnapshotCreationAttributes
  >
  implements SellerSalesOrderItemSnapshotAttributes
{
  public id!: string;
  public order_item_id!: string;
  public order_id!: string;
  public seller_id?: string | null;
  public customer_id?: string | null;
  public product_id?: string | null;
  public unit_business_id?: string | null;
  public order_date!: string;
  public product_name?: string | null;
  public product_brand?: string | null;
  public product_measure?: string | null;
  public quantity?: number | string;
  public unit_price?: number | string;
  public net_total?: number | string;
  public average_cost?: number | string;
  public total_cost?: number | string;
  public has_cost_data!: boolean;
  public icms_value_allocated?: number | string;
  public commission_rate?: number | string;
  public commission_value?: number | string;
  public commission_base?: number | string;
  public manager_commission_value?: number | string;
  public manager_commission_rate?: number | string;
  public markup_value?: number | string;
  public markup_pct?: number | string;
  public contribution_value?: number | string;
  public contribution_pct?: number | string;
  public is_valid_sale!: boolean;
  public last_updated_at?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SellerSalesOrderItemSnapshot.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    order_item_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    order_id: { type: DataTypes.UUID, allowNull: false },
    seller_id: { type: DataTypes.UUID, allowNull: true },
    customer_id: { type: DataTypes.UUID, allowNull: true },
    product_id: { type: DataTypes.UUID, allowNull: true },
    unit_business_id: { type: DataTypes.UUID, allowNull: true },
    order_date: { type: DataTypes.DATEONLY, allowNull: false },
    product_name: { type: DataTypes.STRING(255), allowNull: true },
    product_brand: { type: DataTypes.STRING(100), allowNull: true },
    product_measure: { type: DataTypes.STRING(50), allowNull: true },
    quantity: { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    unit_price: { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    net_total: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    average_cost: { type: DataTypes.DECIMAL(14, 4), defaultValue: 0 },
    total_cost: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    has_cost_data: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    icms_value_allocated: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    commission_rate: { type: DataTypes.DECIMAL(8, 4), defaultValue: 0 },
    commission_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    commission_base: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    manager_commission_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    manager_commission_rate: {
      type: DataTypes.DECIMAL(8, 4),
      allowNull: true,
      defaultValue: 0,
    },
    markup_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    markup_pct: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
    contribution_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
    contribution_pct: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
    is_valid_sale: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    last_updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "seller_sales_order_item_snapshots",
    timestamps: true,
    underscored: true,
  },
);

export default SellerSalesOrderItemSnapshot;