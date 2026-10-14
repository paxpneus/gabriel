import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import { v4 as uuidv4 } from "uuid";
import {
  ContactCouponAttributes,
  ContactCouponCreationAttributes,
} from "./contact-coupons.types";

class ContactCoupon
  extends Model<ContactCouponAttributes, ContactCouponCreationAttributes>
  implements ContactCouponAttributes
{
  public id!: string;
  public contact_id!: string;
  public coupon_id!: string;
  public commission_rate!: number | string;
  public active!: boolean;
  public deactivated_at?: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ContactCoupon.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    contact_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "contacts", key: "id" },
    },
    coupon_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "coupons", key: "id" },
    },
    commission_rate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    deactivated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "contact_coupons",
    timestamps: true,
    underscored: true,
  },
);

export default ContactCoupon;
