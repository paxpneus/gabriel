import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  InventoryBatchItemsAttributes,
  InventoryBatchItemsCreationAttributes,
  ItemStatus,
} from "./inventory-batch-items.types";
import { v4 as uuidv4 } from "uuid";
import Product from "../../products/product.model";

class InventoryBatchItems
  extends Model<
    InventoryBatchItemsAttributes,
    InventoryBatchItemsCreationAttributes
  >
  implements InventoryBatchItemsAttributes
{
  public id!: string;
  public product_id!: string;
  public ean!: string;
  public sku!: string;
  public quantity_stock!: number;
  public quantity_read!: number;
  public divergency!: number;
  public status!: ItemStatus;
  public stock_id!: string;
  public inventory_batch_id!: string;
  public price?: number;
  public initial_divergency?: number

   public product?: Product;
}

InventoryBatchItems.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "products",
        key: "id",
      },
    },
    inventory_batch_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "inventory_batches",
        key: "id",
      },
    },
    ean: { type: DataTypes.STRING, allowNull: false },
    sku: { type: DataTypes.STRING, allowNull: false },
    quantity_stock: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    quantity_read: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    divergency: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    initial_divergency: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },
    status: {
      type: DataTypes.ENUM("FINISHED", "PENDING", "OPEN"),
      defaultValue: "OPEN",
    },
    stock_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "stocks",
        key: "id",
      },
    },
    price: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: "inventory_batch_items",
    underscored: true,
  },
);

export default InventoryBatchItems;
