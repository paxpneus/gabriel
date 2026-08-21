import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  KitComponentAttributes,
  KitComponentCreationAttributes,
} from "./kit-component.types";

class KitComponent
  extends Model<KitComponentAttributes, KitComponentCreationAttributes>
  implements KitComponentAttributes
{
  public id!: string;
  public product_kit_id!: string;
  public product_component_id!: string;
  public quantity!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

KitComponent.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    product_kit_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    product_component_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "kit_components",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["product_kit_id", "product_component_id"],
        name: "uq_kit_components_kit_component",
      },
    ],
  },
);

export default KitComponent;
