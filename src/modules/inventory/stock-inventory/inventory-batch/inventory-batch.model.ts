import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  InventoryBatchAttributes,
  InventoryBatchCreationAttributes,
} from "./inventory-batch.types";
import { v4 as uuidv4 } from "uuid";

class InventoryBatch
  extends Model<InventoryBatchAttributes, InventoryBatchCreationAttributes>
  implements InventoryBatchAttributes
{
  public id!: string;
  public date!: Date;
  public total_quantity_stock!: number;
  public total_quantity_read!: number;
  public number!: string;
  public unit_business_id!: string;
}

InventoryBatch.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    date: { type: DataTypes.DATE, allowNull: false },
    total_quantity_stock: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    total_quantity_read: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    number: { type: DataTypes.STRING, allowNull: false },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "unit_businesses",
        key: "id",
      },
    },
  },
  {
    sequelize,
    tableName: "inventory_batches",
    underscored: true,
    timestamps: true,
  },
);

export default InventoryBatch;
