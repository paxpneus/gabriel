import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  COUPON_DISCOUNT_TYPES,
  CouponAttributes,
  CouponCreationAttributes,
  CouponDiscountType,
} from "./coupons.types";

class Coupon
  extends Model<CouponAttributes, CouponCreationAttributes>
  implements CouponAttributes
{
  public id!: string;
  public code!: string;
  public discount_type?: CouponDiscountType | null;
  public discount_value?: number | string | null;
  public active!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Coupon.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    discount_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      validate: { isIn: [COUPON_DISCOUNT_TYPES as unknown as string[]] },
    },
    discount_value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "coupons",
    timestamps: true,
    underscored: true,
  },
);

export default Coupon;
