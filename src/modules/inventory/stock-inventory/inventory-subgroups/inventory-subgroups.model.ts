import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  InventorySubgroupAttributes,
  InventorySubgroupCreationAttributes,
} from "./inventory-subgroups.types";

class InventorySubgroup
  extends Model<
    InventorySubgroupAttributes,
    InventorySubgroupCreationAttributes
  >
  implements InventorySubgroupAttributes
{
  public id!: string;
  public inventory_batch_id!: string;
  public subgroup_id!: string;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

InventorySubgroup.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    inventory_batch_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "inventory_batches",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    subgroup_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "subgroups",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
  },
  {
    sequelize,
    tableName: "inventory_subgroups",
    timestamps: true,
    underscored: true,
  },
);

export default InventorySubgroup;
