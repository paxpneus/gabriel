import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  PaymentMethodAttributes,
  PaymentMethodCreationAttributes,
} from "./payment_method.types";

class PaymentMethod
  extends Model<PaymentMethodAttributes, PaymentMethodCreationAttributes>
  implements PaymentMethodAttributes
{
  public id!: string;
  public integrations_id!: string;
  public id_system!: string;
  public description!: string;
  public payment_type!: number | null;
  public raw_payload!: Record<string, unknown> | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PaymentMethod.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    integrations_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "integrations",
        key: "id",
      },
    },
    id_system: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    payment_type: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    raw_payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "payment_methods",
    timestamps: true,
    underscored: true,
  },
);

export default PaymentMethod;
