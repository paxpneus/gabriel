import { Model, DataTypes } from "sequelize";
import sequelize from "../../../../config/sequelize";
import {
  ContactCouponAttributes,
  ContactCouponCreationAttributes,
} from "./contact-coupons.types";

// Vínculo afiliado ↔ cupom com a taxa de comissão; um dono ativo por cupom (índice parcial na m326).
class ContactCoupon
  extends Model<ContactCouponAttributes, ContactCouponCreationAttributes>
  implements ContactCouponAttributes
{
  public id!: string;
  public contact_id!: string;
  public coupon_id!: string;
  public commission_rate!: number;
  public active!: boolean;
  public deactivated_at?: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ContactCoupon.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    contact_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "contacts", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    coupon_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "coupons", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
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
