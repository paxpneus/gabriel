import { Model, DataTypes } from "sequelize";
import sequelize from "../../../config/sequelize";
import {
  CONTACT_TYPES,
  ContactAttributes,
  ContactCreationAttributes,
  ContactCustomData,
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
  public id_system?: string | null;
  public document?: string | null;
  public integrations_id?: string | null;
  public unit_business_id?: string | null;
  public user_id?: string | null;
  public custom_data?: ContactCustomData | null;

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
      type: DataTypes.ENUM(...CONTACT_TYPES),
      allowNull: false,
    },
    // Optional since m323: contacts created via /with-user have no Bling id.
    id_system: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    document: {
      type: DataTypes.STRING(20),
      allowNull: true,
      unique: true,
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
     user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    // Generic JSONB bag; ContactService.update merges keys instead of replacing.
    custom_data: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
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
