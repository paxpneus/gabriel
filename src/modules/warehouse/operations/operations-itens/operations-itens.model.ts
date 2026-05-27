import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  OperationsItensAttributes,
  OperationsItensCreationAttributes,
} from "./operations-itens.types";

class OperationsItens
  extends Model<OperationsItensAttributes, OperationsItensCreationAttributes>
  implements OperationsItensAttributes
{
  public id!: string;
  public operation_id!: string;
  public product_id!: string;
  public code?: string | null;
  public quantity!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

OperationsItens.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    operation_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "operations",
        key: "id",
      },
    },
    product_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "products",
        key: "id",
      },
    },
    code: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: "operations_itens",
    timestamps: true,
    underscored: true,
  },
);

export default OperationsItens;
