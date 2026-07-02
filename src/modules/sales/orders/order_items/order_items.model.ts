import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import { orderItemsAttributes, orderItemsCreationAttributes } from "./order_items.types";

class OrderItems
  extends Model<orderItemsAttributes, orderItemsCreationAttributes>
  implements orderItemsAttributes
{
  public id!: string;
  public order_id!: string;
  public name!: string;
  public sku!: string;
  public unit!: string;
  public quantity!: number;
  public price!: number;
  public product_id?: string;
  public integrations_id?: string;
  public source_payload?: Record<string, unknown>;
  public unit_price?: number;
  public gross_total?: number;
  public discount_value?: number;
  public net_total?: number;
  public commission_base?: number;
  public commission_rate?: number;
  public comission_manager_rate?: number;
  public commission_value?: number;
  public average_cost_snapshot?: number;
  public total_cost_snapshot?: number;
  public cost_source?: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

OrderItems.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    order_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "orders", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    sku: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    unit: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "products", key: "id" },
    },
    integrations_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "integrations", key: "id" },
    },
    source_payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    unit_price: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
    },
    gross_total: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    discount_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    net_total: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    commission_base: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    commission_rate: {
      type: DataTypes.DECIMAL(8, 4),
      allowNull: true,
      defaultValue: 0,
    },
    comission_manager_rate: {
      type: DataTypes.DECIMAL(8, 4),
      allowNull: true,
      defaultValue: 0,
    },
    commission_value: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    average_cost_snapshot: {
      type: DataTypes.DECIMAL(14, 4),
      allowNull: true,
      defaultValue: 0,
    },
    total_cost_snapshot: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },
    cost_source: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "order_items",
    timestamps: true,
    underscored: true,
  }
);

export default OrderItems;
