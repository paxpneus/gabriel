import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { orderItemsAttributes, orderItemsCreationAttributes } from "./order_items.types";
import { v4 as uuidv4 } from "uuid";

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
      references: {
        model: "orders",
        key: "id",
      },
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
  },
  {
    sequelize,
    tableName: "order_items",
    timestamps: true,
    underscored: true,
  }
);

export default OrderItems;