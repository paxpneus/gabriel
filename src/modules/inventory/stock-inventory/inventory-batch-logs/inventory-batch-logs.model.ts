import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  InventoryBatchLogsAttributes,
  InventoryBatchLogsCreationAttributes,
} from "./inventory-batch-logs.types";
import { v4 as uuidv4 } from "uuid";

class InventoryBatchLogs
  extends Model<
    InventoryBatchLogsAttributes,
    InventoryBatchLogsCreationAttributes
  >
  implements InventoryBatchLogsAttributes
{
  public id!: string;
  public user_id!: string;
  public quantity_read!: number;
  public inventory_batch_item_id!: string;
  public label_code!: string;
  public date!: Date;
}

InventoryBatchLogs.init(
  {
    id: { type: DataTypes.UUID, defaultValue: uuidv4, primaryKey: true },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    quantity_read: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    inventory_batch_item_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "inventory_batch_items",
        key: "id",
      },
    },
    label_code: { type: DataTypes.STRING, allowNull: false },
    date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "inventory_batch_logs",
    underscored: true,
  },
);

export default InventoryBatchLogs;
