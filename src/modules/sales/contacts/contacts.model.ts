import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import {
  ContactAttributes,
  ContactCreationAttributes,
  ContactType,
} from "./contacts.types";
import { v4 as uuidv4 } from "uuid";

class Contact
  extends Model<ContactAttributes, ContactCreationAttributes>
  implements ContactAttributes
{
  public id!: string;
  public name!: string;
  public type!: ContactType;
  public id_system!: string;
  public integrations_id?: string | null;
  public unit_business_id?: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Contact.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("SELLER", "CUSTOMER"),
      allowNull: false,
    },
    id_system: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    integrations_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "integrations",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    unit_business_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "unit_businesses",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  },
  {
    sequelize,
    tableName: "contacts",
    timestamps: true,
    underscored: true,
  },
);

export default Contact;
