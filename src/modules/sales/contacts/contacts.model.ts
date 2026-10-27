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
  public unit_business_group_id?: string | null;
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
    // Opcional: contato criado via /with-user (ex.: afiliado) não tem id do Bling.
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
    // Grupo de lojas do gerente regional (SELLER_MANAGER): comissão de gerente em todas as lojas do grupo.
    unit_business_group_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "unit_business_groups",
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
    // Valores customizados por tipo (ver ContactCustomData); períodos do gerente (`manager_periods`) só pelo PUT /:id/manager-periods.
    custom_data: {
      type: DataTypes.JSONB,
      allowNull: true,
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
