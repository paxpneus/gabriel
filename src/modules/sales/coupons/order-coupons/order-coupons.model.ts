import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { OrderCouponAttributes, OrderCouponCreationAttributes } from "./order-coupons.types";

// Snapshot do cupom no pedido: gravado uma vez, nunca recalculado (histórico de comissão).
class OrderCoupon
  extends Model<OrderCouponAttributes, OrderCouponCreationAttributes>
  implements OrderCouponAttributes
{
  public order_id!: string;
  public coupon_id!: string;
  public contact_coupon_id?: string | null;
  public discount_amount!: number | string;
  public commission_rate?: number | string | null;
  public commission_amount?: number | string | null;

  public readonly createdAt!: Date;
}

OrderCoupon.init(
  {
    order_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      references: { model: "orders", key: "id" },
    },
    coupon_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      references: { model: "coupons", key: "id" },
    },
    contact_coupon_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "contact_coupons", key: "id" },
    },
    discount_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    commission_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
    },
    commission_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "order_coupons",
    timestamps: true,
    updatedAt: false,
    underscored: true,
  },
);

export default OrderCoupon;
