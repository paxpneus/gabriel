import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  OrderPaymentAttributes,
  OrderPaymentCreationAttributes,
} from "./order_payment.types";

class OrderPayment
  extends Model<OrderPaymentAttributes, OrderPaymentCreationAttributes>
  implements OrderPaymentAttributes
{
  public id!: string;
  public order_id!: string;
  public payment_method_id!: string;
  public id_system!: string | null;
  public amount!: number;
  public due_date!: string | null;
  public notes!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

OrderPayment.init(
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
    payment_method_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "payment_methods", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    id_system: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      get() {
        return Number(this.getDataValue("amount"));
      },
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "order_payments",
    timestamps: true,
    underscored: true,
  },
);

export default OrderPayment;
